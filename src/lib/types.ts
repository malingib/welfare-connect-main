
export enum Gender {
  MALE = "male",
  FEMALE = "female",
  OTHER = "other"
}

export enum CaseType {
  EDUCATION = "education",
  SICKNESS = "sickness",
  DEATH = "death"
}

export enum DisbursementMethod {
  CASH = "cash",
  MPESA = "mpesa",
  BANK = "bank"
}

export enum UserRole {
  SUPER_ADMIN = "super_admin",
  CHAIRPERSON = "chairperson",
  TREASURER = "treasurer",
  SECRETARY = "secretary",
  MEMBER = "member"
}

export interface NextOfKin {
  name: string;
  relationship: string;
  phoneNumber: string;
}

export interface Dependant {
  id: string;
  name: string;
  gender: Gender;
  relationship: string;
  dateOfBirth: Date;
  isDisabled: boolean;
  isEligible: boolean;
}

export interface Member {
  id: string;
  memberNumber: string;
  name: string;
  gender: Gender;
  dateOfBirth: Date;
  nationalIdNumber: string;
  phoneNumber?: string;
  emailAddress?: string;
  residence: string;
  nextOfKin: NextOfKin;
  dependants: Dependant[];
  registrationDate: Date;
  probationEndDate?: Date;
  walletBalance: number;
  isActive: boolean;
  status: 'probation' | 'active' | 'inactive' | 'deceased';
  unpaidCaseContributionCount?: number;
  unpaidCaseObligations?: Array<{
    case_id: string;
    case_number: string;
    contribution_per_member: number;
    case_status: string;
    case_date: string;
  }>;
  reinstatementPenaltyDue?: number;
  totalDue?: number;
  pinHash?: string;
  pinAttempts?: number;
  pinLockedUntil?: Date;
  lastLogin?: Date;
  credentials?: {
    username: string;
    password: string;
  };
}

export interface Case {
  id: string;
  caseNumber: string;
  affectedMemberId: string;
  affectedMember?: Member;
  caseType: CaseType;
  dependantId?: string;
  dependant?: Dependant;
  contributionPerMember: number;
  startDate: Date;
  endDate: Date;
  expectedAmount: number;
  actualAmount: number;
  isActive: boolean;
  isFinalized: boolean;
  createdAt: Date;
}

export interface Transaction {
  id: string;
  memberId: string;
  caseId?: string;
  amount: number;
  transactionType: "contribution" | "registration" | "renewal" | "penalty" | "arrears" | "late_payment" | "wallet_funding" | "disbursement" | "suspense";
  mpesaReference?: string;
  createdAt: Date;
  description: string;
  senderName?: string;
  paymentMethod?: string | null;
  status?: string | null;
}

export interface Disbursement {
  id: string;
  caseId: string;
  memberId: string;
  amount: number;
  date: Date;
  method: DisbursementMethod;
  transactionId: string;
}

export interface Account {
  id: string;
  name: string;
  balance: number;
  type: "registration" | "renewal" | "case_pool" | "suspense";
  year?: number; // For renewal account
  caseId?: string; // For case pool account
}

export interface User {
  id: string;
  username: string;
  name: string;
  email?: string; // Add optional email field
  role: UserRole;
  memberId?: string; // Only for member users
  isActive: boolean;
}

export interface Settings {
  registrationFee: number;
  renewalFee: number;
  penaltyAmount: number;
  paybillNumber: string;
  organizationName: string;
  organizationEmail: string;
  organizationPhone: string;
  memberIdStart: number;
  caseIdStart: number;
}
