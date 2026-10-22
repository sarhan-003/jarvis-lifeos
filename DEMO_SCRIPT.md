# Demo script: Parcel Concierge (under 3 minutes)

Before recording:
- Run `npm run dev` and open http://localhost:5173 in Chrome at 1280×800.
- Turn on **Tool trace** and click **Reset demo**.
- Say "simulated Alexa+" out loud, and don't show Amazon or Alexa logos.

## 0:00–0:20 Problem
"Parcels get stuck in customs and deliveries get missed. Carrier tracking pages are confusing, especially customs: hold codes, HS codes, duty maths. Parcel Concierge makes it a conversation."

## 0:20–2:20 Live demo (keep the tool-trace panel visible)

1. **"Where are my packages?"** The `list_active_shipments` card shows five parcels, with the phone flagged for customs and the coffee machine flagged with a delivery problem.
2. **"Why is my phone stuck in customs?"** `get_customs_status` explains, in plain English, the missing commercial invoice and the unpaid duty: 2.5% × $899 + $12 = $34.48.
3. **"Okay, pay the duty."** `pay_customs_duty(confirm=false)` reads back the amount and shows a confirmation card. Point out that nothing is paid yet. Say **"Yes"**: `pay_customs_duty(confirm=true)` returns reference SLX-PAY-…
4. **"I won't be home tomorrow, can the books come Saturday evening?"** `get_delivery_slots`, then `reschedule_delivery`: Saturday, 4 to 8 PM.
5. **"Leave my running shoes with Sam next door."** `update_delivery_instructions(neighbour)`: "Leave with Sam in 4B".
6. **"Was my headphones parcel delivered? I want to return them."** `get_proof_of_delivery` shows the front-door photo, then asks for the reason. Say **"They don't fit"**: `request_return_pickup`, QR code emailed.

## 2:20–2:45 Architecture
Show the README diagram. "It's a standard MCP server: spec 2025-11-25, Streamable HTTP, 10 tools with schemas and annotations. Alexa+ plugs in through an MCP add-on, and so can any MCP host. Here it is in MCP Inspector." Optionally show `tools/list`.

## 2:45–3:00 Impact and next steps
"Next: real carrier APIs, proactive notifications ('your parcel is held, want me to pay?'), and multiple carriers in one place."
