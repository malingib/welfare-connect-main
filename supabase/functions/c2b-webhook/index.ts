// M-Pesa C2B Webhook - v5 (COMPOUND REFERENCE SUPPORT)
// Supports: Member#Case, Member only, Case only, Phone#Member formats
// Captures all incoming data for manual review when auto-matching fails

/// <reference lib="deno.window" />

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parseBillReference } from './reference-parser.ts'
import { isSmsFailure, sendSmsMessage } from "../_shared/sms.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  try {
    const rawBody = await req.text()
    const url = new URL(req.url)
    const queryParams = Object.fromEntries(url.searchParams.entries())

    console.log('========== C2B WEBHOOK v5 (COMPOUND REF) ==========')
    console.log('Time:', new Date().toISOString())

    let callback: any = { ...queryParams }
    if (rawBody.length > 0) {
      try {
        callback = JSON.parse(rawBody)
      } catch (e) {
        console.log('JSON parse failed, will store raw body')
      }
    }

    const keys = Object.keys(callback)
    if (keys.length === 0) {
      console.warn('⚠️ Received an empty callback. Storing for review.')
    }

    // Lenient extraction: try multiple fields.
    const rawTransID = String(
      callback.TransID ||
      callback.TransId ||
      callback.transId ||
      callback.transID ||
      callback.TransactionID ||
      callback.receipt_number ||
      callback.ReceiptNumber ||
      callback.MpesaReceiptNumber ||
      callback.ThirdPartyTransID ||
      ""
    )
    const transAmount = Number(callback.TransAmount || callback.transAmount || callback.Amount || callback.amount || 0)
    const msisdn = String(callback.MSISDN || callback.msisdn || callback.PhoneNumber || callback.phone_number || '').trim()

    const transTime = String(callback.TransTime || callback.transTime || callback.TransactionTime || callback.transaction_time || '')
    const firstName = String(callback.FirstName || callback.firstName || callback.SenderName || callback.sender_name || '')
    const middleName = String(callback.MiddleName || callback.middleName || '')
    const lastName = String(callback.LastName || callback.lastName || '')
    const normalizedPhone = normalizePhoneNumber(msisdn)
    const normalizedTransID = normalizeMpesaReference(rawTransID)
    const hasMpesaReceipt = normalizedTransID.length > 0
    const suspenseReceipt = hasMpesaReceipt
      ? normalizedTransID
      : buildMissingReceiptKey({
          amount: transAmount,
          billReference: callback.BillRefNumber || callback.billRefNumber || callback.AccountNumber,
          phoneNumber: normalizedPhone || msisdn,
          transTime,
        })

    if (!hasMpesaReceipt) {
      console.warn(`⚠️ Missing transaction ID in C2B callback. Using suspense key: ${suspenseReceipt}`)
    }

    const billRefNumber = String(callback.BillRefNumber || callback.billRefNumber || callback.AccountNumber || suspenseReceipt)

    const senderName = [firstName, middleName, lastName].filter(Boolean).join(' ').trim() || 'Unknown'
    const transactionDate = parseMpesaTimestamp(transTime)

    // === NEW: Parse compound reference ===
    const parsed = parseBillReference(billRefNumber)
    console.log('--- Parsed Reference ---')
    console.log('Raw:', billRefNumber)
    console.log('Format:', parsed.format)
    console.log('Member:', parsed.memberNumber, '| Case:', parsed.caseNumber, '| Phone:', parsed.phoneNumber)
    console.log('------------------------')

    // Persist a small breadcrumb
    await supabase.from('audit_logs').insert({
      action: 'INSERT',
      table_name: 'c2b-webhook',
      status: 'success',
      new_values: {
        custom_action: 'C2B_WEBHOOK_RECEIVED',
        mpesa_receipt_number: hasMpesaReceipt ? normalizedTransID : null,
        amount: transAmount,
        phone_number: normalizedPhone || null,
        reference: billRefNumber || null,
        reference_format: parsed.format,
        trans_time_raw: transTime || null,
        generated_receipt: !hasMpesaReceipt,
      },
    })
    
    // === Resolution Phase ===
    let memberId: string | null = null
    let caseId: string | null = null
    let matchType: string = 'none'
    let phoneMatchedMemberId: string | null = null
    let caseActive: boolean = false
    let caseContributionAmount: number | null = null
    let membershipApplication: any = null

    // Application payment codes are resolved before member numbers. An approved
    // applicant is not a member yet, so routing this through members would lose
    // the payment in suspense.
    if (billRefNumber.trim()) {
      const { data: application } = await supabase
        .from('membership_applications')
        .select('id, full_name, phone_number, status, payment_status, payment_code')
        .eq('payment_code', billRefNumber.trim().toUpperCase())
        .maybeSingle()
      if (application?.status === 'payment_pending') {
        membershipApplication = application
        console.log('✅ Membership application resolved by payment code:', application.payment_code)
      }
    }

    // 1. Resolve member number if present in reference
    if (parsed.memberNumber) {
      const { data: member } = await supabase
        .from('members')
        .select('id')
        .eq('member_number', parsed.memberNumber)
        .single()
      if (member) {
        memberId = member.id
        console.log('✅ Member resolved by number:', parsed.memberNumber)
      } else {
        console.log('⚠️ Member number not found:', parsed.memberNumber)
      }
    }

    // 2. Resolve case number if present in reference
    if (parsed.caseNumber) {
      const { data: caseData } = await supabase
        .from('cases')
        .select('id, contribution_per_member, is_active, is_finalized')
        .eq('case_number', parsed.caseNumber)
        .single()
      if (caseData) {
        if (caseData.is_active && !caseData.is_finalized) {
          caseId = caseData.id
          caseActive = true
          caseContributionAmount = caseData.contribution_per_member
          console.log('✅ Case resolved and active:', parsed.caseNumber, '| Contribution:', caseContributionAmount)
        } else {
          console.log('⚠️ Case found but not active/finalized:', parsed.caseNumber)
        }
      } else {
        console.log('⚠️ Case number not found:', parsed.caseNumber)
      }
    }

    // 3. Fallback: try phone number from reference (legacy Phone#Member format)
    if (!memberId && parsed.phoneNumber) {
      const normalizedRefPhone = normalizePhoneNumber(parsed.phoneNumber)
      const { data: phoneMember } = await supabase
        .from('members')
        .select('id')
        .eq('phone_number', normalizedRefPhone)
        .single()
      if (phoneMember) {
        memberId = phoneMember.id
        console.log('✅ Member resolved by reference phone:', parsed.phoneNumber)
      }
    }

    // 4. Fallback: try payer's phone number (only when no member was specified in reference)
    if (!memberId && normalizedPhone && parsed.format !== 'member_and_case' && parsed.format !== 'phone_and_member') {
      const { data: phoneMember } = await supabase
        .from('members')
        .select('id')
        .eq('phone_number', normalizedPhone)
        .single()
      if (phoneMember) {
        phoneMatchedMemberId = phoneMember.id
        console.log('ℹ️ Phone suggestion (not auto-crediting):', normalizedPhone)
      }
    }

    // Determine match type for logging
    if (memberId && caseId) {
      matchType = 'member_and_case'
    } else if (memberId) {
      matchType = parsed.format === 'phone_and_member' ? 'phone_and_member' : 'member_number'
    } else if (caseId) {
      matchType = 'case_only'
    } else if (phoneMatchedMemberId) {
      matchType = 'phone_suggestion'
    }

    console.log('=== Resolution Summary ===')
    console.log('Member ID:', memberId, '| Case ID:', caseId, '| Match Type:', matchType)
    console.log('===========================')

    // === Transaction Creation Phase ===
    let existingTxByReceipt: { id: string } | null = null
    if (hasMpesaReceipt) {
      const { data: existingTx } = await supabase
        .from('transactions')
        .select('id')
        .eq('mpesa_reference', normalizedTransID)
        .limit(1)
        .maybeSingle()

      if (existingTx) {
        existingTxByReceipt = existingTx as { id: string }
        console.warn(`⚠️ Duplicate C2B callback skipped: mpesa_reference=${normalizedTransID}, existing_tx_id=${existingTxByReceipt.id}`)
        await supabase.from('audit_logs').insert({
          action: 'INSERT',
          table_name: 'transactions',
          status: 'ignored',
          new_values: {
            custom_action: 'C2B_DUPLICATE_RECEIPT_SKIPPED',
            mpesa_receipt_number: normalizedTransID,
            existing_transaction_id: existingTxByReceipt.id,
            reference: billRefNumber || null,
          },
        })
      }
    }

    if (!existingTxByReceipt && membershipApplication && transAmount > 0 && hasMpesaReceipt) {
      const { data: settings } = await supabase
        .from('settings')
        .select('registration_fee')
        .limit(1)
        .maybeSingle()
      const expectedAmount = Number(settings?.registration_fee || 0)
      if (expectedAmount > 0 && transAmount !== expectedAmount) {
        console.warn('⚠️ Application payment amount mismatch; sending to suspense', { expectedAmount, transAmount })
      } else {
        const { error: applicationPaymentError } = await supabase
          .from('membership_applications')
          .update({
            payment_status: 'received',
            payment_received_at: new Date().toISOString(),
            payment_receipt: normalizedTransID,
            payment_amount: transAmount,
            payment_phone_number: normalizedPhone || null,
            payment_metadata: {
              source: 'c2b_webhook',
              bill_reference: billRefNumber,
              sender_name: senderName,
              transaction_date: transactionDate.toISOString(),
              raw_callback: callback,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', membershipApplication.id)
          .eq('status', 'payment_pending')

        if (applicationPaymentError) throw applicationPaymentError

        await supabase.from('audit_logs').insert({
          action: 'MEMBERSHIP_PAYMENT_RECEIVED',
          table_name: 'membership_applications',
          record_id: membershipApplication.id,
          status: 'success',
          new_values: { payment_code: billRefNumber, receipt: normalizedTransID, amount: transAmount },
        })

        const { error: notificationError } = await supabase.from('notifications').insert({
          role: 'admin',
          title: 'New Member Registration Payment',
          message: `Registration payment of KES ${transAmount.toLocaleString('en-KE')} received for ${membershipApplication.full_name} (${membershipApplication.payment_code}). Receipt: ${normalizedTransID}.`,
          category: 'registration_payment_received',
          event_key: `application:${membershipApplication.id}:registration_payment_received`,
          data: {
            source: 'c2b_webhook',
            application_id: membershipApplication.id,
            payment_code: membershipApplication.payment_code,
            amount: transAmount,
            receipt: normalizedTransID,
          },
        })
        if (notificationError) {
          console.error('Could not queue registration payment admin alert:', notificationError.message)
        }

        // Registration payments are matched to a unique application payment code,
        // so they can be activated immediately. Previously this callback only
        // marked the payment as received and waited for an admin click, which
        // delayed member-number delivery by 20+ minutes.
        const { data: activationResult, error: activationError } = await supabase.rpc('activate_membership_application', {
          p_application_id: membershipApplication.id,
        })
        if (activationError || !activationResult?.success) {
          const message = activationError?.message || activationResult?.message || 'Membership activation failed'
          await supabase.from('audit_logs').insert({
            action: 'MEMBERSHIP_ACTIVATION_FAILED',
            table_name: 'membership_applications',
            record_id: membershipApplication.id,
            status: 'error',
            new_values: { payment_code: billRefNumber, receipt: normalizedTransID, error: message },
          })
          throw new Error(message)
        }

        const { data: activatedMember } = await supabase
          .from('members')
          .select('id, name, member_number, phone_number, probation_end_date')
          .eq('id', activationResult.id)
          .single()
        const { data: activationTemplate } = await supabase
          .from('sms_templates')
          .select('raw_template')
          .eq('trigger_key', 'registration_activated')
          .maybeSingle()
        const activationMessage = String(
          activationTemplate?.raw_template ||
          'Malanga Welfare: Congratulations {name}. Your membership is now active. Your member number is {memberNumber}.',
        )
          .replaceAll('{name}', String(activatedMember?.name || membershipApplication.full_name))
          .replaceAll('{memberNumber}', String(activatedMember?.member_number || activationResult.member_number))
          .replaceAll('{phoneNumber}', String(activatedMember?.phone_number || membershipApplication.phone_number))
          .replaceAll('{portalLink}', 'https://malangawelfare.org/login?role=member')

        const { data: activationNotification, error: activationNotificationError } = await supabase.from('notifications').insert({
          member_id: activationResult.id,
          role: 'member',
          title: 'Membership Activated',
          message: activationMessage,
          category: 'registration_activated',
          event_key: `application:${membershipApplication.id}:registration_activated`,
          data: {
            source: 'c2b_webhook',
            application_id: membershipApplication.id,
            member_number: activationResult.member_number,
            probation_end_date: activatedMember?.probation_end_date || null,
          },
        })
        if (activationNotificationError) {
          console.error('Could not queue membership activation notification:', activationNotificationError.message)
        }

        const { data: whatsappNotification } = await supabase.from('notifications').insert({
          member_id: activationResult.id,
          role: 'member',
          title: 'Members WhatsApp Group Invitation',
          message: 'Your members WhatsApp group invitation is ready.',
          category: 'whatsapp_group_invite',
          event_key: `application:${membershipApplication.id}:whatsapp_group_invite`,
          data: { source: 'c2b_webhook', application_id: membershipApplication.id, use_current_whatsapp_group_link: true },
        }).select('id').single()

        try {
          const { data: template } = await supabase
            .from('sms_templates')
            .select('raw_template')
            .eq('trigger_key', 'registration_activated')
            .maybeSingle()
          const rawTemplate = String((template as { raw_template?: unknown } | null)?.raw_template || '').trim()
          const message = (rawTemplate || activationMessage)
            .replaceAll('{name}', String(activatedMember?.name || membershipApplication.full_name))
            .replaceAll('{memberNumber}', String(activatedMember?.member_number || activationResult.member_number))
            .replaceAll('{phoneNumber}', String(activatedMember?.phone_number || membershipApplication.phone_number))
            .replaceAll('{portalLink}', 'https://malangawelfare.org/login?role=member')
          const results = await sendSmsMessage([activatedMember?.phone_number || membershipApplication.phone_number], message)
          const activationSmsSent = results.length > 0 && results.every((result) => !isSmsFailure(result))
          const activationNotificationId = (activationNotification as { data?: { id?: string } | null } | null)?.data?.id
          if (activationSmsSent && activationNotificationId) {
            await supabase.from('notifications').update({ sms_sent_at: new Date().toISOString(), data: { source: 'c2b_webhook', application_id: membershipApplication.id, member_number: activationResult.member_number, sms_delivery_mode: 'immediate' } }).eq('id', activationNotificationId)
          }
          await Promise.all(results.map((result) => supabase.from('audit_logs').insert({
            action: isSmsFailure(result) ? 'SMS_FAILED' : 'SMS_SENT',
            table_name: 'sms',
            status: isSmsFailure(result) ? 'error' : 'success',
            metadata: {
              source: 'c2b_webhook',
              trigger_key: 'registration_activated',
              phone_number: result.phoneNumber,
              provider: result.provider,
              provider_message_id: result.providerMessageId,
              provider_response: result.raw,
              application_id: membershipApplication.id,
              member_number: activatedMember?.member_number || activationResult.member_number,
            },
          })))

          const { data: whatsappSettings } = await supabase.from('settings').select('whatsapp_group_link').limit(1).maybeSingle()
          const whatsappLink = String(whatsappSettings?.whatsapp_group_link || Deno.env.get('WHATSAPP_GROUP_LINK') || '').trim()
          if (whatsappLink && whatsappNotification?.id) {
            const { data: whatsappTemplate } = await supabase.from('sms_templates').select('raw_template').eq('trigger_key', 'whatsapp_group_invite').maybeSingle()
            const whatsappMessage = String(whatsappTemplate?.raw_template || 'Malanga Welfare: Join the members WhatsApp group here: {whatsappLink}. Please do not share this link publicly.').replaceAll('{whatsappLink}', whatsappLink)
            const whatsappResults = await sendSmsMessage([activatedMember?.phone_number || membershipApplication.phone_number], whatsappMessage)
            const whatsappSent = whatsappResults.length > 0 && whatsappResults.every((result) => !isSmsFailure(result))
            if (whatsappSent) await supabase.from('notifications').update({ sms_sent_at: new Date().toISOString(), data: { source: 'c2b_webhook', application_id: membershipApplication.id, sms_delivery_mode: 'immediate' } }).eq('id', whatsappNotification.id)
            await Promise.all(whatsappResults.map((result) => supabase.from('audit_logs').insert({ action: isSmsFailure(result) ? 'SMS_FAILED' : 'SMS_SENT', table_name: 'sms', status: isSmsFailure(result) ? 'error' : 'success', metadata: { source: 'c2b_webhook', trigger_key: 'whatsapp_group_invite', phone_number: result.phoneNumber, provider: result.provider, provider_message_id: result.providerMessageId, provider_response: result.raw, application_id: membershipApplication.id } })))
          }
        } catch (smsError) {
          console.error('Membership activation SMS failed:', smsError instanceof Error ? smsError.message : String(smsError))
        }

        return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // SCENARIO 1: Member + Case + valid receipt -> create case contribution row.
    if (!existingTxByReceipt && memberId && caseId && transAmount > 0 && hasMpesaReceipt) {
      console.log('✅ Member + Case: Creating case contribution transaction')
      
      const { error: txError } = await supabase.from('transactions').insert({
        member_id: memberId,
        case_id: caseId,
        amount: transAmount,
        transaction_type: 'contribution',
        payment_method: 'mpesa',
        mpesa_reference: normalizedTransID,
        reference: billRefNumber,
        description: `M-Pesa Case Payment - Case ${parsed.caseNumber} for Member ${parsed.memberNumber} - ${senderName}`,
        status: 'completed',
        created_at: transactionDate.toISOString(),
        metadata: { 
          webhook_source: 'c2b_v5',
          payment_for: 'case',
          payer_phone: normalizedPhone,
          target_member_id: memberId,
          case_number: parsed.caseNumber,
          expected_contribution: caseContributionAmount,
        },
      })

      if (txError) throw txError

      console.log('✅ Case contribution created successfully for member:', memberId, 'case:', caseId)

      try {
        const { data: member } = await supabase.from('members').select('phone_number, name, wallet_balance').eq('id', memberId).single()
        if (member?.phone_number) {
          const firstName = (member.name || '').split(' ')[0] || 'Valued Member'
          const balance = Number(member.wallet_balance || 0).toLocaleString('en-KE')
          const smsMessage = `Mpendwa ${firstName}, Mchango wa KES ${transAmount.toLocaleString('en-KE')} umepokelewa kwa kesi ${parsed.caseNumber} kutoka kwa ${senderName}. M-Pesa Ref: ${normalizedTransID}. Salio: KES ${balance}. Asante!`
          const smsResults = await sendSmsMessage([member.phone_number], smsMessage)
          await Promise.all(smsResults.map((result, i) => supabase.from('audit_logs').insert({
            action: isSmsFailure(result) ? 'SMS_FAILED' : 'SMS_SENT',
            table_name: 'sms',
            status: isSmsFailure(result) ? 'error' : 'success',
            metadata: { source: 'c2b_webhook', trigger_key: 'payment_received', phone_number: result.phoneNumber, message: smsMessage, provider: result.provider },
          })))
        }
      } catch (smsError) {
        console.error('SMS notification failed:', smsError instanceof Error ? smsError.message : String(smsError))
      }

    // SCENARIO 2: Member only → Regular wallet funding
    } else if (!existingTxByReceipt && memberId && !caseId && transAmount > 0 && hasMpesaReceipt) {
      console.log('✅ Member only: Creating wallet funding transaction')
      
      const { error: txError } = await supabase.from('transactions').insert({
        member_id: memberId,
        amount: transAmount,
        transaction_type: 'wallet_funding',
        payment_method: 'mpesa',
        mpesa_reference: normalizedTransID,
        reference: billRefNumber,
        description: `M-Pesa C2B - ${senderName}`,
        status: 'completed',
        created_at: transactionDate.toISOString(),
        metadata: { webhook_source: 'c2b_v5', raw_payload: callback },
      })

      if (txError) throw txError

      console.log('✅ Wallet funding created successfully for member:', memberId)

      try {
        const { data: member } = await supabase.from('members').select('phone_number, name, wallet_balance').eq('id', memberId).single()
        if (member?.phone_number) {
          const firstName = (member.name || '').split(' ')[0] || 'Valued Member'
          const balance = Number(member.wallet_balance || 0).toLocaleString('en-KE')
          const smsMessage = `Mpendwa ${firstName}, Malipo ya KES ${transAmount.toLocaleString('en-KE')} kutoka kwa ${senderName} yamepokelewa. M-Pesa Ref: ${normalizedTransID}. Salio: KES ${balance}. Asante!`
          const smsResults = await sendSmsMessage([member.phone_number], smsMessage)
          await Promise.all(smsResults.map((result, i) => supabase.from('audit_logs').insert({
            action: isSmsFailure(result) ? 'SMS_FAILED' : 'SMS_SENT',
            table_name: 'sms',
            status: isSmsFailure(result) ? 'error' : 'success',
            metadata: { source: 'c2b_webhook', trigger_key: 'payment_received', phone_number: result.phoneNumber, message: smsMessage, provider: result.provider },
          })))
        }
      } catch (smsError) {
        console.error('SMS notification failed:', smsError instanceof Error ? smsError.message : String(smsError))
      }

    // SCENARIO 3: No member resolved → Save to suspense for manual review
    } else if (!existingTxByReceipt) {
      console.log('⚠️ Payment could not be mapped safely. Saving to suspense.')

      const phoneSuggestionNote = phoneMatchedMemberId ? ' (phone match suggestion recorded)' : ''
      
      let fallbackReason = 'Account reference missing; manual review required'
      if (parsed.format === 'member_and_case') {
        fallbackReason = `Member ${parsed.memberNumber} not found${phoneSuggestionNote}`
        if (!caseActive && parsed.caseNumber) {
          fallbackReason = `Case ${parsed.caseNumber} not found or inactive; Member ${parsed.memberNumber} not found`
        }
      } else if (parsed.format === 'case_only') {
        fallbackReason = `Case-only payment (${parsed.caseNumber}); cannot identify which member to credit${phoneSuggestionNote}`
      } else if (parsed.format === 'phone_and_member') {
        fallbackReason = `Phone/member reference not resolved${phoneSuggestionNote}`
      } else if (parsed.memberNumber) {
        fallbackReason = `Member number ${parsed.memberNumber} not found${phoneSuggestionNote}`
      } else if (parsed.caseNumber) {
        fallbackReason = `Case ${parsed.caseNumber} not found or inactive${phoneSuggestionNote}`
      } else if (!hasMpesaReceipt) {
        fallbackReason = `Missing M-Pesa receipt in callback; held in suspense to prevent duplicate wallet credit${phoneSuggestionNote}`
      }

      const suspenseData = {
        mpesa_receipt_number: suspenseReceipt,
        phone_number: normalizedPhone || 'MISSING',
        amount: transAmount,
        sender_name: senderName,
        transaction_date: transactionDate.toISOString(),
        status: 'pending',
        reference: billRefNumber || null,
        source: 'c2b',
        notes: `M-Pesa C2B - ${senderName} - Account: ${billRefNumber || 'N/A'} [${parsed.format}]`,
        // NEW: Structured intent fields
        intended_member_id: memberId,
        intended_case_id: caseId,
        reference_type: parsed.format,
        metadata: { 
          webhook_source: 'c2b_v5',
          raw_payload: callback,
          raw_body: rawBody,
          reason: fallbackReason,
          missing_mpesa_receipt: !hasMpesaReceipt,
          extracted_mpesa_receipt: hasMpesaReceipt ? normalizedTransID : null,
          match_type: matchType,
          phone_matched_member_id: phoneMatchedMemberId,
          parsed_reference: {
            member_number: parsed.memberNumber,
            case_number: parsed.caseNumber,
            phone: parsed.phoneNumber,
            format: parsed.format,
          },
          case_active: caseActive,
          expected_case_contribution: caseContributionAmount,
        },
      }

      const { data: result, error: insertError } = await supabase
        .from('wrong_mpesa_transactions')
        .insert(suspenseData)
        .select()
        .single()

      if (insertError) {
        console.error('❌ Suspense insert error:', insertError.message)
        await supabase.from('audit_logs').insert({
          action: 'INSERT',
          table_name: 'wrong_mpesa_transactions',
          status: 'error',
          new_values: {
            custom_action: 'C2B_SUSPENSE_INSERT_FAILED',
            error: insertError.message,
            mpesa_receipt_number: suspenseData.mpesa_receipt_number,
            phone_number: suspenseData.phone_number,
            amount: suspenseData.amount,
            reference: suspenseData.reference,
            source: suspenseData.source,
            reference_type: suspenseData.reference_type,
            reason: suspenseData.metadata?.reason,
          },
        })
      } else {
        console.log('✅ SUCCESS: Inserted to suspense for manual review.', result.id)
      }
    } else {
      console.log('ℹ️ Duplicate callback already recorded in transactions; no new row inserted.')
    }

    // Always accept the webhook to prevent M-Pesa from resending
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error('========== C2B WEBHOOK GLOBAL ERROR ==========')
    console.error('Error:', error.message)
    
    await supabase.from('audit_logs').insert({
      action: 'INSERT',
      table_name: 'c2b-webhook',
      status: 'error',
      new_values: { custom_action: 'C2B_WEBHOOK_ERROR', error: error.message, body: await req.text() },
    })

    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted despite error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

function normalizePhoneNumber(phone: string): string {
  if (!phone || phone.trim() === '') return ''
  const cleaned = phone.replace(/\D/g, '')
  if (!cleaned) return ''
  if (cleaned.startsWith('254')) return cleaned
  if (cleaned.startsWith('0')) return '254' + cleaned.substring(1)
  if (cleaned.length === 9 && cleaned.startsWith('7')) return '254' + cleaned
  return cleaned
}

function normalizeMpesaReference(value: string): string {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase()
}

function sanitizeReferencePart(value: string): string {
  const cleaned = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  return cleaned.length > 0 ? cleaned : 'NA'
}

function buildMissingReceiptKey(input: {
  amount: number
  billReference: unknown
  phoneNumber: string
  transTime: string
}): string {
  const parts = [
    sanitizeReferencePart(String(input.amount || 0)),
    sanitizeReferencePart(String(input.billReference || '')),
    sanitizeReferencePart(input.phoneNumber || ''),
    sanitizeReferencePart(input.transTime || ''),
  ]
  return `MISSING-${parts.join('-')}`.slice(0, 100)
}

function parseMpesaTimestamp(value: string): Date {
  const cleaned = value.replace(/\D/g, '')
  if (cleaned.length === 14) {
    const isoLike = `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}T${cleaned.slice(8, 10)}:${cleaned.slice(10, 12)}:${cleaned.slice(12, 14)}+03:00`
    const parsed = new Date(isoLike)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  const fallback = new Date(value)
  if (!Number.isNaN(fallback.getTime())) {
    return fallback
  }

  return new Date()
}
