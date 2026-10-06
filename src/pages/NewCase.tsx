import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronLeft } from 'lucide-react';
import DashboardLayout from '@/layouts/DashboardLayout';
import CaseForm from '@/components/forms/CaseForm';
import { Button } from '@/components/ui/button';
import { Gender, Member } from '@/lib/types';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { mapDbMemberToMember } from '@/lib/db-types';
import { persistentCache } from '@/lib/cache';
import { DEPENDANT_COLUMNS, MEMBER_LIST_COLUMNS } from '@/lib/supabaseSelectColumns';
import { invokeWithAppToken } from '@/lib/appAuth';
import { captureEvent } from '@/lib/posthog';

type CaseInsert = Database["public"]["Tables"]["cases"]["Insert"];

const NewCase = () => {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchMembers = async () => {
      try {
        setIsLoading(true);

        // Get all members from Supabase with pagination to handle >1000 members
        const pageSize = 1000;
        let from = 0;
        let allMembersData: any[] = [];
        
        while (true) {
          const { data: membersBatch, error: membersError } = await supabase
            .from('members')
            .select(MEMBER_LIST_COLUMNS)
            .range(from, from + pageSize - 1);

          if (membersError) {
            console.error('Error fetching members batch:', membersError, 'Details:', JSON.stringify(membersError));
            throw membersError;
          }

          if (membersBatch && membersBatch.length > 0) {
            allMembersData = allMembersData.concat(membersBatch);
          }

          if (!membersBatch || membersBatch.length < pageSize) {
            break; // No more pages
          }
          
          from += pageSize;
        }

        // Fetch dependants from the dependants table
        const { data: dependantsData, error: dependantsError } = await (supabase as any)
          .from('dependants')
          .select(DEPENDANT_COLUMNS);
        
        if (dependantsError) {
          console.error('Error fetching dependants:', dependantsError);
        }
        
        // Group dependants by member_id
        const dependantsByMember: Record<string, any[]> = {};
        if (dependantsData) {
          for (const dep of dependantsData) {
            if (!dependantsByMember[dep.member_id]) {
              dependantsByMember[dep.member_id] = [];
            }
            dependantsByMember[dep.member_id].push({
              id: dep.id,
              name: dep.name,
              gender: dep.gender,
              relationship: dep.relationship,
              dateOfBirth: dep.date_of_birth,
              isDisabled: dep.is_disabled || false,
              isEligible: dep.is_eligible || true,
            });
          }
        }

        // Map database members to the application Member model
        const mappedMembers = allMembersData.map(dbMember => {
          try {
            const memberDependants = dependantsByMember[dbMember.id] || [];
            const mapped = mapDbMemberToMember(dbMember, memberDependants);
            return mapped;
          } catch (error) {
            console.error('Error mapping member:', dbMember, error);
            console.error('Member ID:', dbMember.id, 'Name:', dbMember.name);
            console.error('Member data:', JSON.stringify(dbMember, null, 2));
            return null;
          }
        }).filter(Boolean) as Member[]; // Remove any null values from mapping errors

        if (!mappedMembers || mappedMembers.length === 0) {
          toast.warning("No Members Found", {
            description: "There are no members in the system. Please add members first.",
          });
        } else {
          // Sort members alphabetically by name
          const sortedMembers = mappedMembers.sort((a, b) => a.name.localeCompare(b.name));
          setMembers(sortedMembers);
        }
      } catch (error) {
        console.error('Error in fetchMembers:', error);
        toast.error("Error", {
          description: "Failed to load members. Please try again.",
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchMembers();
  }, []);

  const handleSubmit = async (data: any) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    
    try {
      const trimmedCaseNumber = String(data.caseNumber || '').trim();
      if (!trimmedCaseNumber) {
        toast.error("Error", { description: "Case number is required." });
        return;
      }

      // Prevent duplicate case numbers
      const { data: existingCase, error: existingError } = await supabase
        .from('cases')
        .select('id')
        .eq('case_number', trimmedCaseNumber)
        .maybeSingle();

      if (existingError) {
        console.error('Error checking existing case:', existingError);
        throw existingError;
      }

      if (existingCase) {
        toast.error("Duplicate Case Number", {
          description: `Case number ${trimmedCaseNumber} already exists.`,
        });
        return;
      }

      // Get total member count for calculation
      const { count: memberCount, error: countError } = await supabase
        .from('members')
        .select('id', { count: 'exact', head: true })
        .in('status', ['active', 'probation']);

      if (countError) {
        console.error('Error getting member count:', countError);
        throw countError;
      }

      const totalMembers = memberCount || 0;
      const totalContribution = data.contributionPerMember * totalMembers;
      const dependantId = data.dependantId === 'self' ? null : (data.dependantId || null);

      // Create the case directly in the cases table
      const casePayload: CaseInsert = {
        case_number: trimmedCaseNumber,
        affected_member_id: data.affectedMemberId,
        case_type: data.caseType,
        expected_amount: totalContribution,
        contribution_per_member: data.contributionPerMember,
        start_date: data.startDate,
        end_date: data.endDate,
        is_active: true,
        is_finalized: false,
        actual_amount: 0,
        dependant_id: dependantId,
      };
      const { data: result, error } = await (supabase.from('cases') as any)
        .insert([casePayload])
        .select()
        .single();

      if (error || !result) {
        console.error('Error creating case:', error);
        toast.error("Error", {
          description: error?.message || "Failed to create case. Please try again.",
        });
        return;
      }

      const caseResult = result as any;
      persistentCache.invalidate('cases-list');
      persistentCache.invalidate('cases-mpesa-v2');

      captureEvent('Case Created', {
        case_number: trimmedCaseNumber,
        case_type: data.caseType,
        contribution_per_member: Number(data.contributionPerMember),
        expected_amount: totalContribution,
        affected_member_id: data.affectedMemberId,
      });

      toast.success("Case created successfully", {
        description: "Case saved. Members can now fund their wallets — contributions will be processed automatically.",
      });

      // Fire-and-forget: run wallet waterfall in the background
      invokeWithAppToken('api-trigger-waterfall', { case_id: caseResult.id })
        .catch(err => console.error('Error triggering wallet waterfall:', err));

      navigate(`/cases/${caseResult.id}`);
    } catch (error) {
      console.error('Error:', error);
      toast.error("Error", {
        description: "An unexpected error occurred. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center">
          <Button variant="ghost" onClick={() => navigate('/cases')} className="mr-4">
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back to Cases
          </Button>
          <div>
            <h1 className="text-3xl font-bold mb-1">Create New Case</h1>
            <p className="text-muted-foreground">Start a new welfare case</p>
          </div>
        </div>

        <div className="bg-card rounded-lg border p-6">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <p>Loading members...</p>
            </div>
          ) : (
            <CaseForm onSubmit={handleSubmit} members={members} isSubmitting={isSubmitting} />
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default NewCase;
