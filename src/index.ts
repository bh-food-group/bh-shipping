import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getShippingZone } from './utils/zone';
import { env } from 'hono/adapter';

const app = new Hono();

app.use('*', cors());

const TEST_EMAIL = '';

const WILDERSNAILCOFFEE_DISCOUNT_IDS = [
  7082155933744, 7082155966512, 7082156032048, 7082156130352, 7082156195888,
  7082156261424, 7082156294192, 8134116507957, 8134118867253, 8233508471093,
  8807683948853, 8807686275381, 9949616963893,
];

const CMARKET_FREE_SHIPPING_EMAILS = [
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

  const MILDA_DISCOUNT =
    email === 'milldabakery@gmail.com'
      ? {
          description: 'Milda 100% Off',
          value: '100.0',
          value_type: 'percentage',
        }
      : undefined;

  const PM_TABLEWARE_DISCOUNT =
    (email === 'pm@cmarket.ca' || email === TEST_EMAIL) &&
    lineItems.every((item: any) =>
      item.title.toLowerCase().includes('tableware')
    )
      ? {
          description: 'PM Tableware 100% Off',
          value: '100.0',
          value_type: 'percentage',
        }
      : undefined;

  const PM_PRODUCT_DISCOUNT =
    (email === 'pm@cmarket.ca' || email === TEST_EMAIL) &&
    lineItems.every((item: any) => item.vendor === 'PM')
      ? {
          description: 'PM Products 100% Off',
          value: '100.0',
          value_type: 'percentage',
        }
      : undefined;

  const HQ_DISCOUNT =
    (email === 'ordercmarket@gmail.com' || email === TEST_EMAIL) &&
    lineItems.every((item: any) => item.vendor === 'HQ')
      ? {
          description: 'HQ Products 100% Off',
          value: '100.0',
          value_type: 'percentage',
        }
      : undefined;

  const WILDER_SNI_DISCOUNT =
    (email === 'woochanp@gmail.com' || email === TEST_EMAIL) &&
    lineItems.every((item: any) =>
      WILDERSNAILCOFFEE_DISCOUNT_IDS.includes(item.id)
    )
      ? {
          description: 'WilderSnailCoffee 2$ Off',
          value: '2.0',
          value_type: 'amount',
          amount: '2.0',
        }
      : undefined;

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
          title: CMARKET_FREE_SHIPPING_EMAILS.includes(email)
            ? 'Free Shipping for CMarket'
            : (+shippingFee === 0 ? 'Free' : zoneInfo.zone) +
              ' Shipping' +
              (+shippingFee === 0
                ? ' (over ' + zoneInfo.minimumOrder + ')'
                : ''),
          price: shippingFee,
          quantity: 1,
        },
      ],
      applied_discount:
        MILDA_DISCOUNT ||
        HQ_DISCOUNT ||
        PM_PRODUCT_DISCOUNT ||
        PM_TABLEWARE_DISCOUNT ||
        WILDER_SNI_DISCOUNT,
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
