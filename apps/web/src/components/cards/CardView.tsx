import type { Card } from '../../types';
import { ShipmentListCard } from './ShipmentListCard';
import { TimelineCard } from './TimelineCard';
import { CustomsCard } from './CustomsCard';
import { SlotsCard } from './SlotsCard';
import { ConfirmationCard } from './ConfirmationCard';
import { ErrorCard, PodCard, ReturnCard } from './MiscCards';

export function CardView({ card, onSay, active }: { card: Card; onSay: (t: string) => void; active: boolean }) {
  switch (card.type) {
    case 'shipment_list':
      return <ShipmentListCard data={card.data} onSay={onSay} />;
    case 'timeline':
      return <TimelineCard data={card.data} />;
    case 'customs':
      return <CustomsCard data={card.data} onSay={onSay} />;
    case 'slots':
      return <SlotsCard data={card.data} onSay={onSay} />;
    case 'confirmation':
      return <ConfirmationCard data={card.data} onSay={onSay} active={active} />;
    case 'pod':
      return <PodCard data={card.data} onSay={onSay} />;
    case 'return':
      return <ReturnCard data={card.data} />;
    case 'error':
      return <ErrorCard data={card.data} onSay={onSay} />;
    default: {
      const unreachable: never = card;
      return unreachable;
    }
  }
}
