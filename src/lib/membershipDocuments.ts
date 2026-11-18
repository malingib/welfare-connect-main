import type { Member } from './types';
import { createReportFilename, downloadBlob } from './reportExport';
import { loadDocx } from './reportExportLibs';

type DocxModule = typeof import('docx');

const GROUP_NAME = 'Malanga Community Welfare';

// A4 landscape, 0.5" margins.
const PAGE_WIDTH = 16838;
const PAGE_HEIGHT = 11906;
const MARGIN = 720;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// S/No | Full Name | National ID No. | Gender | Disability Yes | Disability No | Position | Phone No. | Signature
const MEMBERSHIP_LIST_WIDTHS = [800, 3300, 2000, 950, 650, 650, 1400, 1900, 3748];
// Name | ID No. | Reason
const TRANSITION_WIDTHS = [6200, 3200, 5998];

const normalizeMemberStatus = (member: Member) =>
  String(member.status || (member.isActive ? 'active' : 'inactive')).toLowerCase();

/** Members currently on the group register (active or probation). */
export const membersOnRegister = (members: Member[]) =>
  members.filter((member) => {
    const status = normalizeMemberStatus(member);
    return status === 'active' || status === 'probation';
  });

/** Members who are no longer part of the group (deceased or inactive). */
export const membersWhoLeft = (members: Member[]) =>
  members.filter((member) => {
    const status = normalizeMemberStatus(member);
    return status === 'deceased' || status === 'inactive' || member.isActive === false;
  });

/** Reason shown on the membership transition form, derived from member status. */
export const membershipExitReason = (member: Member) =>
  normalizeMemberStatus(member) === 'deceased' ? 'Deceased' : 'Inactive';

const memberNumberValue = (member: Member) => {
  const match = String(member.memberNumber || '').match(/\d+/);
  return match ? Number(match[0]) : NaN;
};

const byMemberNumber = (a: Member, b: Member) => {
  const aValue = memberNumberValue(a);
  const bValue = memberNumberValue(b);
  if (!Number.isNaN(aValue) && !Number.isNaN(bValue) && aValue !== bValue) {
    return aValue - bValue;
  }
  return String(a.memberNumber || '').localeCompare(String(b.memberNumber || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
};

const capitalize = (value: unknown) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
};

const displayValue = (value: unknown) => (value == null ? '' : String(value));

/**
 * Columns of the Group Membership List, shared by the Word document and the
 * Excel/CSV exports so the three always stay in sync. The Word report has a
 * grouped "Disability" header spanning Yes/No; the spreadsheet equivalent is
 * split into two separate columns.
 */
export const membershipListHeaders: { key: string; label: string }[] = [
  { key: 'serialNumber', label: 'S/No.' },
  { key: 'name', label: 'Full Name' },
  { key: 'nationalIdNumber', label: 'National ID No.' },
  { key: 'gender', label: 'Gender' },
  { key: 'disabilityYes', label: 'Disability Yes' },
  { key: 'disabilityNo', label: 'Disability No' },
  { key: 'position', label: 'Position' },
  { key: 'phoneNumber', label: 'Phone No.' },
  { key: 'signature', label: 'Signature' },
];

export interface MembershipListRow {
  serialNumber: number;
  name: string;
  nationalIdNumber: string;
  gender: string;
  disabilityYes: string;
  disabilityNo: string;
  position: string;
  phoneNumber: string;
  signature: string;
}

/** Build the membership-list rows exactly as they appear in the Word report. */
export const buildMembershipListRows = (members: Member[]): MembershipListRow[] =>
  [...membersOnRegister(members)].sort(byMemberNumber).map((member, index) => ({
    serialNumber: index + 1,
    name: displayValue(member.name),
    nationalIdNumber: displayValue(member.nationalIdNumber),
    gender: capitalize(member.gender),
    disabilityYes: '',
    disabilityNo: 'No',
    position: 'Member',
    phoneNumber: displayValue(member.phoneNumber),
    signature: '',
  }));

const borders = (docx: DocxModule) => ({
  top: { style: docx.BorderStyle.SINGLE, size: 4, color: '000000' },
  bottom: { style: docx.BorderStyle.SINGLE, size: 4, color: '000000' },
  left: { style: docx.BorderStyle.SINGLE, size: 4, color: '000000' },
  right: { style: docx.BorderStyle.SINGLE, size: 4, color: '000000' },
});

const headerCell = (
  docx: DocxModule,
  text: string,
  width: number,
  options: { columnSpan?: number; rowSpan?: number } = {},
) =>
  new docx.TableCell({
    width: { size: width, type: docx.WidthType.DXA },
    columnSpan: options.columnSpan,
    rowSpan: options.rowSpan,
    verticalAlign: docx.VerticalAlign.CENTER,
    shading: { fill: 'D9D9D9', type: docx.ShadingType.CLEAR },
    borders: borders(docx),
    children: [
      new docx.Paragraph({
        alignment: docx.AlignmentType.CENTER,
        spacing: { before: 40, after: 40 },
        children: [new docx.TextRun({ text, bold: true, size: 18 })],
      }),
    ],
  });

const dataCell = (
  docx: DocxModule,
  text: string,
  width: number,
  options: { align?: (typeof docx.AlignmentType)[keyof typeof docx.AlignmentType] } = {},
) =>
  new docx.TableCell({
    width: { size: width, type: docx.WidthType.DXA },
    verticalAlign: docx.VerticalAlign.CENTER,
    borders: borders(docx),
    children: [
      new docx.Paragraph({
        alignment: options.align || docx.AlignmentType.LEFT,
        spacing: { before: 20, after: 20 },
        children: [new docx.TextRun({ text: displayValue(text), size: 18 })],
      }),
    ],
  });

const landscapePage = (docx: DocxModule) => ({
  page: {
    // docx swaps width/height when orientation is landscape, so pass portrait values.
    size: {
      width: PAGE_HEIGHT,
      height: PAGE_WIDTH,
      orientation: docx.PageOrientation.LANDSCAPE,
    },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  },
});

const pageFooter = (docx: DocxModule) =>
  new docx.Footer({
    children: [
      new docx.Paragraph({
        alignment: docx.AlignmentType.CENTER,
        children: [new docx.TextRun({ children: [docx.PageNumber.CURRENT], size: 16 })],
      }),
    ],
  });

const centeredTitle = (docx: DocxModule, text: string, size: number) =>
  new docx.Paragraph({
    alignment: docx.AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new docx.TextRun({ text, bold: true, size, color: '1F4E79' })],
  });

const buildMembershipListDocument = (docx: DocxModule, members: Member[]) => {
  const listRows = buildMembershipListRows(members);

  const headerRow1 = new docx.TableRow({
    tableHeader: true,
    children: [
      headerCell(docx, 'S/No.', MEMBERSHIP_LIST_WIDTHS[0], { rowSpan: 2 }),
      headerCell(docx, 'Full Name', MEMBERSHIP_LIST_WIDTHS[1], { rowSpan: 2 }),
      headerCell(docx, 'National ID No.', MEMBERSHIP_LIST_WIDTHS[2], { rowSpan: 2 }),
      headerCell(docx, 'Gender', MEMBERSHIP_LIST_WIDTHS[3], { rowSpan: 2 }),
      headerCell(docx, 'Disability', MEMBERSHIP_LIST_WIDTHS[4] + MEMBERSHIP_LIST_WIDTHS[5], { columnSpan: 2 }),
      headerCell(docx, 'Position', MEMBERSHIP_LIST_WIDTHS[6], { rowSpan: 2 }),
      headerCell(docx, 'Phone No.', MEMBERSHIP_LIST_WIDTHS[7], { rowSpan: 2 }),
      headerCell(docx, 'Signature', MEMBERSHIP_LIST_WIDTHS[8], { rowSpan: 2 }),
    ],
  });

  const headerRow2 = new docx.TableRow({
    tableHeader: true,
    children: [
      headerCell(docx, 'Yes', MEMBERSHIP_LIST_WIDTHS[4]),
      headerCell(docx, 'No', MEMBERSHIP_LIST_WIDTHS[5]),
    ],
  });

  const rows = listRows.map((row) => {
    const disabilityNoWidth = MEMBERSHIP_LIST_WIDTHS[5];
    return new docx.TableRow({
      height: { value: 620, rule: docx.HeightRule.ATLEAST },
      children: [
        dataCell(docx, String(row.serialNumber), MEMBERSHIP_LIST_WIDTHS[0], { align: docx.AlignmentType.CENTER }),
        dataCell(docx, row.name, MEMBERSHIP_LIST_WIDTHS[1]),
        dataCell(docx, row.nationalIdNumber, MEMBERSHIP_LIST_WIDTHS[2]),
        dataCell(docx, row.gender, MEMBERSHIP_LIST_WIDTHS[3], { align: docx.AlignmentType.CENTER }),
        dataCell(docx, row.disabilityYes, MEMBERSHIP_LIST_WIDTHS[4], { align: docx.AlignmentType.CENTER }),
        dataCell(docx, row.disabilityNo, disabilityNoWidth, { align: docx.AlignmentType.CENTER }),
        dataCell(docx, row.position, MEMBERSHIP_LIST_WIDTHS[6], { align: docx.AlignmentType.CENTER }),
        dataCell(docx, row.phoneNumber, MEMBERSHIP_LIST_WIDTHS[7]),
        dataCell(docx, row.signature, MEMBERSHIP_LIST_WIDTHS[8]),
      ],
    });
  });

  return new docx.Document({
    sections: [
      {
        properties: landscapePage(docx),
        footers: { default: pageFooter(docx) },
        children: [
          centeredTitle(docx, 'GROUP MEMBERSHIP LIST', 32),
          new docx.Paragraph({
            alignment: docx.AlignmentType.CENTER,
            spacing: { after: 240 },
            children: [
              new docx.TextRun({ text: 'NAME OF THE COMMUNITY GROUP: ', bold: true, size: 22 }),
              new docx.TextRun({ text: GROUP_NAME, size: 22 }),
            ],
          }),
          new docx.Table({
            width: { size: CONTENT_WIDTH, type: docx.WidthType.DXA },
            columnWidths: MEMBERSHIP_LIST_WIDTHS,
            rows: [headerRow1, headerRow2, ...rows],
          }),
        ],
      },
    ],
  });
};

const buildMembershipTransitionDocument = (docx: DocxModule, members: Member[]) => {
  const left = [...membersWhoLeft(members)].sort(byMemberNumber);

  const headerRow = new docx.TableRow({
    tableHeader: true,
    children: [
      headerCell(docx, 'Name', TRANSITION_WIDTHS[0]),
      headerCell(docx, 'ID No.', TRANSITION_WIDTHS[1]),
      headerCell(docx, 'Reason(Death/Resignation/Expulsion/Desertion)', TRANSITION_WIDTHS[2]),
    ],
  });

  const rows = left.map(
    (member) =>
      new docx.TableRow({
        height: { value: 620, rule: docx.HeightRule.ATLEAST },
        children: [
          dataCell(docx, displayValue(member.name), TRANSITION_WIDTHS[0]),
          dataCell(docx, displayValue(member.nationalIdNumber), TRANSITION_WIDTHS[1]),
          dataCell(docx, membershipExitReason(member), TRANSITION_WIDTHS[2]),
        ],
      }),
  );

  return new docx.Document({
    sections: [
      {
        properties: landscapePage(docx),
        footers: { default: pageFooter(docx) },
        children: [
          new docx.Paragraph({
            spacing: { before: 240, after: 120 },
            children: [new docx.TextRun({ text: 'Membership transition:', bold: true, size: 28 })],
          }),
          new docx.Paragraph({
            spacing: { after: 240 },
            children: [
              new docx.TextRun({
                text: 'Names and ID No of members who have left the organization:-',
                size: 24,
              }),
            ],
          }),
          new docx.Table({
            width: { size: CONTENT_WIDTH, type: docx.WidthType.DXA },
            columnWidths: TRANSITION_WIDTHS,
            rows: [headerRow, ...rows],
          }),
          new docx.Paragraph({
            spacing: { before: 120 },
            children: [
              new docx.TextRun({ text: '*Attach list is they are many', bold: true, italics: true, size: 22 }),
            ],
          }),
        ],
      },
    ],
  });
};

/** Download the Group Membership List (active and probation members) as a Word document. */
export const downloadMembershipListDocx = async (members: Member[]) => {
  const docx = await loadDocx();
  const blob = await docx.Packer.toBlob(buildMembershipListDocument(docx, members));
  downloadBlob(createReportFilename('group_membership_list', 'docx'), blob);
};

/** Download the Membership Transition list (deceased / inactive members) as a Word document. */
export const downloadMembershipTransitionDocx = async (members: Member[]) => {
  const docx = await loadDocx();
  const blob = await docx.Packer.toBlob(buildMembershipTransitionDocument(docx, members));
  downloadBlob(createReportFilename('membership_transition', 'docx'), blob);
};
