// Wave 1 card render slots. Each renders its forward-optional KanbanTask field when present
// and null otherwise, so the card is unchanged today but each Wave 1 lane can own one slot
// file (due dates / PR linking / comments / assignee) without colliding in KanbanCard.tsx.
export { CardDueDate } from './CardDueDate';
export { CardPrBadge } from './CardPrBadge';
export { CardComments } from './CardComments';
export { CardAssignee } from './CardAssignee';
