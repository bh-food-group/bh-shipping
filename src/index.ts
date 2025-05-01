import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getShippingZone } from './utils/zone';
import { env } from 'hono/adapter';

const app = new Hono();

app.use('*', cors());

const TEST_EMAIL = 'earlyoonj@gmail.com';

const CMARKET_FREE_SHIPPING_EMAILS = [
  'earlyoonj@gmail.com',
  'milldabakery@gmail.com',
  'ordercmarket@gmail.com',
  'pm@cmarket.ca',
  'coquitlam@cmarket.ca',
];

const CMARKET_5_DISCOUNT_EMAILS = [
  'coquitlam@cmarket.ca',
  'ordercmarket@gmail.com',
  'pm@cmarket.ca',
  'milldabakery@gmail.com',
  'marketing@cmarket.ca',
  'desk@cmarket.ca',
  'boxd.simon@gmail.com',
];

app.get('/', (c) => {
  return c.json({ message: 'Hello, World!' });
});

app.post('/create-draft-order', async (c) => {
  const { email, postalCode, lineItems, customer } = await c.req.json();

  console.log(lineItems);

  const IS_PM_TABLEWARE =
    (email === 'pm@cmarket.ca' || email === TEST_EMAIL) &&
    lineItems.every((item: any) =>
      item.title.toLowerCase().includes('tableware')
    );

  const IS_HQ_PRODUCT =
    (email === 'ordercmarket@gmail.com' || email === TEST_EMAIL) &&
    lineItems.every((item: any) => item.vendor === 'HQ');

  const prefix = postalCode.slice(0, 3).toUpperCase();
  const zoneInfo = getShippingZone(prefix);

  if (!zoneInfo) {
    return c.json(
      {
        error:
          'BC 내의 정확한 우편번호를 기재해주세요\nPlease enter valid ZIP code in BC.',
      },
      422
    );
  }

  let shippingFee = 0;
  if (!CMARKET_FREE_SHIPPING_EMAILS.includes(email)) {
    if (zoneInfo.minimumOrder && zoneInfo.fee) {
      const subtotal = lineItems.reduce(
        (sum: number, item: any) => sum + item.price * item.quantity,
        0
      );
      if (subtotal < zoneInfo.minimumOrder) {
        shippingFee = zoneInfo.fee;
      }
    } else {
      return c.json(
        {
          error: '배송 불가 지역입니다.\nShipping not available for this area',
        },
        422
      );
    }
  }

  const { SHOP, SHOPIFY_ADMIN_API_TOKEN } = env(c);

  const draftOrderPayload = {
    draft_order: {
      email,
      line_items: [
        ...lineItems,
        {
          title:
            (CMARKET_FREE_SHIPPING_EMAILS.includes(email)
              ? 'Free'
              : zoneInfo.zone) +
            (shippingFee === 0 ? ' Free' : '') +
            ' Shipping' +
            (shippingFee === 0 ? ' (over ' + zoneInfo.minimumOrder + ')' : ''),
          price: shippingFee,
          quantity: 1,
        },
      ],
      applied_discount:
        IS_HQ_PRODUCT || IS_PM_TABLEWARE
          ? {
              description: '100% Off',
              value: '100.0',
              value_type: 'percentage',
            }
          : CMARKET_5_DISCOUNT_EMAILS.includes(email)
          ? {
              description: '5% Off for CMarket',
              value: '5.0',
              value_type: 'percentage',
            }
          : undefined,
      customer: customer ? { id: customer.id } : undefined,
      use_customer_default_address: true,
    },
  };

  try {
    const resp = await fetch(
      `https://${SHOP}/admin/api/2025-04/draft_orders.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN as string,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(draftOrderPayload),
      }
    );

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error('Shopify API Error Response:', errorText);
      return c.json({ error: `Shopify error: ${errorText}` }, 500);
    }

    const data = (await resp.json()) as any;

    if (!data?.draft_order?.invoice_url) {
      console.log('No invoice_url in response:', data);
      return c.json({ error: 'No invoice url returned' }, 500);
    }

    return c.json({ invoiceUrl: data.draft_order.invoice_url });
  } catch (err: any) {
    console.error(err);
    return c.json({ error: 'Failed to create draft order.' }, 500);
  }
});

export default app;
