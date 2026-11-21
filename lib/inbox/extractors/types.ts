import type { InboxData, InboxKind } from '@/types';
import type { InboxSource } from '../sources';

export interface ExtractorInput {
  subject: string;
  body: string;
  /** App-timezone calendar date the message arrived (yyyy-MM-dd). */
  receivedDate: string;
  attachmentNames: string[];
}

export interface Extracted {
  kind: InboxKind;
  title: string;
  summary: string | null;
  data: InboxData;
}

export type Extractor = (source: InboxSource, input: ExtractorInput) => Extracted;
