/**
 * The vocabulary the demo environment is built from.
 *
 * Every name, firm and locality below is FICTIONAL. They are drawn to look
 * like the records a South-Indian planning office would hold, because a demo
 * populated with "Test User 1" teaches a reviewer nothing about whether the
 * columns are wide enough or whether the sort order reads correctly — but
 * none of it refers to a real person, a real firm or a real property.
 *
 * The districts and localities are real place names used as plausible
 * ADDRESSES ONLY. No survey number, plot number or applicant here corresponds
 * to any actual land record.
 */

export const FIRST_NAMES = [
  'Ravi', 'Priya', 'Anil', 'Meena', 'Suresh', 'Lakshmi', 'Vikram', 'Deepa',
  'Rajesh', 'Sunitha', 'Krishna', 'Padma', 'Naveen', 'Anitha', 'Srinivas',
  'Kavitha', 'Mahesh', 'Swathi', 'Ramesh', 'Bhavani', 'Gopal', 'Sridevi',
  'Prakash', 'Vasantha', 'Kiran', 'Jyothi', 'Venkat', 'Rohini', 'Sandeep',
  'Aruna', 'Harish', 'Nirmala', 'Chandra', 'Sarita', 'Murali', 'Indira',
] as const;

export const SURNAMES = [
  'Kumar', 'Sharma', 'Reddy', 'Iyer', 'Naidu', 'Rao', 'Singh', 'Menon',
  'Gupta', 'Varma', 'Chowdary', 'Prasad', 'Murthy', 'Sastry', 'Pillai',
  'Raju', 'Babu', 'Devi', 'Nair', 'Bhat', 'Acharya', 'Mohan',
] as const;

/** Districts used as plausible addresses. */
export const DISTRICTS = [
  { name: 'Guntur', mandals: ['Guntur East', 'Guntur West', 'Tadikonda', 'Mangalagiri'] },
  { name: 'Krishna', mandals: ['Vijayawada Rural', 'Penamaluru', 'Gannavaram', 'Ibrahimpatnam'] },
  { name: 'Visakhapatnam', mandals: ['Gajuwaka', 'Bheemunipatnam', 'Anandapuram', 'Pendurthi'] },
  { name: 'Nellore', mandals: ['Nellore Rural', 'Kovur', 'Muthukur', 'Venkatachalam'] },
  { name: 'Kurnool', mandals: ['Kurnool', 'Kallur', 'Orvakal', 'Gudur'] },
  { name: 'Anantapur', mandals: ['Anantapur', 'Rapthadu', 'Kuderu', 'Atmakur'] },
] as const;

export const LOCALITIES = [
  'Brodipet', 'Arundelpet', 'Lakshmipuram', 'Gorantla', 'Nallapadu',
  'Patamata', 'Benz Circle', 'Gunadala', 'Bhavanipuram', 'Auto Nagar',
  'MVP Colony', 'Seethammadhara', 'Madhurawada', 'Rushikonda',
  'Dargamitta', 'Magunta Layout', 'Balaji Nagar', 'Santhapet',
  'Ashok Nagar', 'Vidya Nagar', 'Shanti Nagar', 'Gandhi Nagar',
] as const;

export const STREETS = [
  'Main Road', '4th Line', '12th Cross Road', 'Temple Street', 'Market Road',
  'Ring Road Service Lane', 'Canal Road', 'School Street', 'Bank Street',
  'Housing Board Road', 'Nehru Street', 'Station Road',
] as const;

export const LAYOUTS = [
  'Sai Enclave', 'Green Meadows', 'Vasavi Township', 'Sree Gardens',
  'Lakeview Colony', 'Amaravati Heights', 'Sunrise Estates', 'Nandi Layout',
  'Pearl City Layout', 'Sarovar Enclave',
] as const;

export const FIRMS = [
  'Kumar & Associates', 'Skyline Design Studio', 'Aakriti Architects',
  'Vastu Consultants', 'Meridian Planners', 'Sthapati Design Works',
  'BluePrint Engineering', 'BBAS Consultancy', 'Axis Architects',
  'Prabhava Design Collective',
] as const;

/**
 * Building profiles. Each is internally coherent — a warehouse does not get
 * four dwelling units — because the fee engine and the document rules both
 * read these fields, and an incoherent profile produces a demand and a
 * checklist that make no sense together.
 */
export const BUILDING_PROFILES = [
  {
    key: 'INDIVIDUAL_HOUSE',
    buildingUse: 'DWELLING',
    buildingSubUse: 'Individual residence',
    occupancyType: 'A_RESIDENTIAL',
    structureType: 'RCC',
    landUseZone: 'RESIDENTIAL',
    floors: [1, 3] as const,
    basements: [0, 0] as const,
    units: [1, 2] as const,
    plotArea: [150, 500] as const,
    farTarget: [1.0, 1.8] as const,
  },
  {
    key: 'APARTMENT_BLOCK',
    buildingUse: 'APARTMENT',
    buildingSubUse: 'Multi-dwelling block',
    occupancyType: 'A_RESIDENTIAL',
    structureType: 'RCC',
    landUseZone: 'RESIDENTIAL',
    floors: [4, 9] as const,
    basements: [0, 2] as const,
    units: [8, 48] as const,
    plotArea: [800, 3000] as const,
    farTarget: [1.8, 2.8] as const,
  },
  {
    key: 'RETAIL_SHOP',
    buildingUse: 'SHOP',
    buildingSubUse: 'Retail premises',
    occupancyType: 'F_MERCANTILE',
    structureType: 'RCC',
    landUseZone: 'COMMERCIAL',
    floors: [1, 3] as const,
    basements: [0, 1] as const,
    units: [0, 0] as const,
    plotArea: [120, 700] as const,
    farTarget: [1.2, 2.2] as const,
  },
  {
    key: 'OFFICE_BLOCK',
    buildingUse: 'OFFICE',
    buildingSubUse: 'Commercial offices',
    occupancyType: 'E_BUSINESS',
    structureType: 'STEEL',
    landUseZone: 'COMMERCIAL',
    floors: [3, 8] as const,
    basements: [1, 2] as const,
    units: [0, 0] as const,
    plotArea: [600, 2500] as const,
    farTarget: [2.0, 3.0] as const,
  },
  {
    key: 'WAREHOUSE',
    buildingUse: 'WAREHOUSE',
    buildingSubUse: 'Storage godown',
    occupancyType: 'H_STORAGE',
    structureType: 'STEEL',
    landUseZone: 'INDUSTRIAL',
    floors: [1, 2] as const,
    basements: [0, 0] as const,
    units: [0, 0] as const,
    plotArea: [1000, 5000] as const,
    farTarget: [0.6, 1.2] as const,
  },
  {
    key: 'SCHOOL',
    buildingUse: 'SCHOOL',
    buildingSubUse: 'Primary and secondary school',
    occupancyType: 'B_EDUCATIONAL',
    structureType: 'RCC',
    landUseZone: 'INSTITUTIONAL',
    floors: [2, 4] as const,
    basements: [0, 0] as const,
    units: [0, 0] as const,
    plotArea: [1500, 6000] as const,
    farTarget: [0.8, 1.6] as const,
  },
] as const;

export type BuildingProfile = (typeof BUILDING_PROFILES)[number];

/** Remarks an officer would actually type. Keeps the history readable. */
export const FORWARD_REMARKS = [
  'Drawings and documents verified. Recommended for the next stage.',
  'Setbacks and coverage checked against the sanctioned plan. In order.',
  'Site particulars tally with the survey sketch. Forwarded.',
  'Technical scrutiny report reviewed. No adverse observations.',
  'Fee demand settled in full. Placed before the next authority.',
  'Land use conforms to the zoning of the area. Recommended.',
] as const;

export const APPROVAL_REMARKS = [
  'All statutory requirements satisfied. Permission accorded.',
  'Recommendations of the lower authorities accepted. Approved.',
  'No open shortfalls and fees realised in full. Sanctioned.',
] as const;

export const REJECTION_REMARKS = [
  'Proposed setbacks fall short of the prescribed minimum and cannot be regularised. Rejected.',
  'The plot abuts a road narrower than the width required for the proposed height. Rejected.',
] as const;

/**
 * Shortfall wordings, per kind. `action` is what the applicant must DO.
 *
 * Typed rather than `as const`: the four lists have different lengths, so
 * inference would give each one its own tuple type and `SHORTFALL_TEXT[kind]`
 * would be a union of tuples that nothing can be picked from uniformly. One
 * declared element type is what makes the four interchangeable at the call
 * site, which is the whole reason they are keyed by kind.
 */
/**
 * One line of a shortfall letter, as the officer writes it.
 *
 * The item fields are not decoration. A demonstration whose letters all read
 * "—" under Category and Document required teaches the viewer that those
 * columns are empty in the product, which is the opposite of true — so the
 * seed fills what a real officer would fill.
 */
export type ShortfallItemText = {
  description: string;
  category: string;
  action: string;
  document: string;
  remarks?: string;
  /** Defaults to mandatory. False is the rare, deliberate case. */
  optional?: boolean;
};

export type ShortfallText = {
  title: string;
  /** What is wrong, in the officer's words. */
  description: string;
  /** What the applicant must do about it. This is the sentence that gets sent. */
  action: string;
  /**
   * The itemised deficiencies. Several of them, because a real shortfall
   * letter asks for several things at once and a product demonstrated on
   * one-line letters never shows the case that actually hurts — six items
   * where five come back right and one does not.
   */
  items: readonly ShortfallItemText[];
};

export const SHORTFALL_TEXT: Record<
  'DOCUMENT' | 'FEE' | 'TECHNICAL' | 'CLARIFICATION',
  readonly ShortfallText[]
> = {
  DOCUMENT: [
    {
      title: 'Title documents incomplete',
      description:
        'The encumbrance certificate on record predates the transaction shown in the sale deed, and the link documents for the intervening period are not on file.',
      action: 'Place the complete chain of title on record, item by item as listed below.',
      items: [
        {
          description: 'Encumbrance certificate does not cover the period up to the current date.',
          category: 'Title & ownership',
          action: 'Upload an encumbrance certificate covering the last thirteen years, up to the current date.',
          document: 'Encumbrance Certificate',
          remarks: 'The certificate on file stops eleven months short of the sale deed.',
        },
        {
          description: 'Link document for the 2019 transfer is not on record.',
          category: 'Title & ownership',
          action: 'Upload the registered link document evidencing the 2019 transfer.',
          document: 'Registered sale deed / link document',
        },
        {
          description: 'Property tax receipt for the current year has not been produced.',
          category: 'Title & ownership',
          action: 'Upload the latest property tax receipt for the plot.',
          document: 'Property tax receipt',
        },
      ],
    },
    {
      title: 'Site records not legible',
      description:
        'The survey sketch and the boundary particulars uploaded with the application cannot be read, and the extent cannot be verified against them.',
      action: 'Upload legible, authenticated site records.',
      items: [
        {
          description: 'Survey sketch is not legible; boundaries cannot be read.',
          category: 'Site & survey',
          action: 'Upload a clear, authenticated survey sketch showing all four boundaries.',
          document: 'Survey sketch',
        },
        {
          description: 'Boundary schedule does not match the sketch on record.',
          category: 'Site & survey',
          action: 'Submit a boundary schedule that agrees with the survey sketch, signed by the LTP.',
          document: 'Boundary schedule',
          remarks: 'North and east boundaries are interchanged between the two documents.',
        },
      ],
    },
    {
      title: 'Layout approval particulars required',
      description:
        'The plot is stated to form part of an approved layout, but the approval particulars have not been produced.',
      action: 'Produce the layout approval and the approved plan showing this plot.',
      items: [
        {
          description: 'Layout approval order has not been placed on record.',
          category: 'Layout & approvals',
          action: 'Upload the layout approval order together with its approved plan.',
          document: 'Layout approval order',
        },
        {
          description: 'Plot number on the application does not appear on the layout plan produced.',
          category: 'Layout & approvals',
          action: 'Confirm the plot number as it appears on the approved layout, with the supporting page.',
          document: 'Approved layout plan',
        },
        {
          description: 'Road width abutting the plot is not shown on any record.',
          category: 'Site & survey',
          action: 'Show the abutting road width on the site plan, certified by the LTP.',
          document: 'Site plan',
          optional: true,
        },
      ],
    },
  ],
  FEE: [
    {
      title: 'Differential development charges payable',
      description:
        'The built-up area shown on the revised drawing exceeds the area on which the original demand was raised.',
      action: 'Pay the supplementary demand raised against this application.',
      items: [
        {
          description: 'Development charges short-collected on the revised built-up area.',
          category: 'Fees & charges',
          action: 'Pay the supplementary demand raised against this application.',
          document: 'Payment receipt',
        },
      ],
    },
    {
      title: 'Betterment charges short-collected',
      description:
        'Betterment charges were computed on the earlier plot extent and fall short of the extent now declared.',
      action: 'Pay the supplementary demand raised against this application.',
      items: [
        {
          description: 'Betterment charges recomputed on the declared extent.',
          category: 'Fees & charges',
          action: 'Pay the supplementary demand raised against this application.',
          document: 'Payment receipt',
        },
      ],
    },
  ],
  TECHNICAL: [
    {
      title: 'Drawing does not meet the required provision',
      description:
        'The parking provision and the staircase detail on the submitted drawing fall short of the requirement for the proposed built-up area.',
      action: 'Revise the drawing on the points listed below and upload the corrected version.',
      items: [
        {
          description: 'Parking area shown falls short of the provision required.',
          category: 'Setbacks & coverage',
          action: 'Revise the drawing to show the required parking provision.',
          document: 'Revised floor plan',
        },
        {
          description: 'Staircase width is below the minimum for the proposed occupancy.',
          category: 'Fire & safety',
          action: 'Revise the staircase detail and upload the corrected drawing.',
          document: 'Revised floor plan',
          remarks: 'Shown as 0.9 m against the 1.2 m required.',
        },
      ],
    },
    {
      title: 'Setbacks not as required',
      description:
        'The rear and side setbacks shown on the site plan are below the requirement for the plot extent and the proposed height.',
      action: 'Revise the site plan to show compliant setbacks.',
      items: [
        {
          description: 'Rear setback shown below the requirement for the proposed height.',
          category: 'Setbacks & coverage',
          action: 'Revise the site plan to show the required rear setback.',
          document: 'Revised site plan',
        },
        {
          description: 'Side setback on the west is not dimensioned.',
          category: 'Setbacks & coverage',
          action: 'Dimension the west side setback on the site plan.',
          document: 'Revised site plan',
        },
      ],
    },
  ],
  CLARIFICATION: [
    {
      title: 'Clarification on plot extent',
      description: 'The plot extent in the application differs from the extent shown on the survey sketch.',
      action: 'Confirm the correct plot extent and place the supporting record on file.',
      items: [
        {
          description: 'Extent declared differs from the extent on the survey sketch.',
          category: 'Site & survey',
          action: 'Confirm which extent is correct, with the record that supports it.',
          document: 'Survey record',
        },
      ],
    },
  ],
};

export const RESOLUTION_TEXT = [
  'The requested record has been uploaded against this application.',
  'Corrected drawing and the supporting document have been placed on file.',
  'The supplementary demand has been paid and the receipt is on record.',
] as const;

export const ACCEPT_REMARKS = [
  'Response verified and found in order. Shortfall closed.',
  'The document supplied answers the observation. Proceeding.',
] as const;

/**
 * Why a first response was not enough.
 *
 * A demonstration in which every shortfall is answered correctly the first
 * time never shows the multi-cycle history the product is built around — and
 * that history is the part nobody believes until they see it.
 */
export const REJECT_REMARKS = [
  'The document produced does not cover the period asked for. The shortfall stays open on that item.',
  'One item has been answered; the rest of the letter has not. Returned for the balance.',
  'The record uploaded is a copy of the one already on file. The observation is not answered.',
] as const;

/** What an applicant writes on a second attempt, having been sent back. */
export const SECOND_CYCLE_TEXT = [
  'The correct record has now been obtained and uploaded against the item that was returned.',
  'The remaining items are answered below. The earlier upload was the wrong document; this one covers the full period.',
  'A fresh certificate covering the period asked for has been placed on file.',
] as const;

/** One line of an applicant's answer, against one item. */
export const ITEM_RESPONSE_TEXT = [
  'Uploaded against the Documents tab of this application.',
  'The corrected record has been placed on file.',
  'Obtained from the registrar and uploaded.',
  'Revised and re-uploaded as asked.',
] as const;
