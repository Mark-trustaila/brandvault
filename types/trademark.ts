export interface GoodsAndServices {
  search_class: { number: number };
  text: string;
}

export interface Trademark {
  id: string;
  family_id?: string | null;
  registry_name: string;
  mark_text: string;
  application_number: string;
  registration_number?: string;
  status: 'Registered' | 'Pending' | 'Published' | 'Expired' | 'Abandoned';
  filing_date?: string;
  registration_date?: string;
  expiry_date?: string;
  publication_date?: string;
  client_agent_name?: string;
  owner_name?: string;
  owner_country?: string;
  representative_name?: string;
  representative_reference?: string;
  needs_data?: boolean;
  /** Verbatim registry status. Present only on registry-synced records. */
  registry_status_raw?: string;
  /** Device-mark image, served from the LawPanel CDN. Null on most records. */
  image_url?: string;
  good_and_services?: GoodsAndServices[];
  publication_notes?: string;
}

export interface TrademarkData {
  count: number;
  trademarks: Trademark[];
  company?: { id: string; name: string } | null;
  fetchedAt: string;
  source?: string;
}

export interface Note {
  id: string;
  text: string;
  html?: string | null;
  link?: string | null;
  author: string;
  authorFull: string;
  date: string;
}

export interface Obligation {
  type: string;
  desc: string;
  dueDate: Date | null;
  windowStart: Date | null;
  daysUntil: number | null;
  critical: boolean;
  actionable: boolean;
  overdue: boolean;
  inWindow: boolean;
  // Set when the base date needed to compute the deadline is missing.
  uncertain?: boolean;
}
