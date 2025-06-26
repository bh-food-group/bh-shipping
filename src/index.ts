import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getShippingZone } from './utils/zone';
import { env } from 'hono/adapter';

const app = new Hono();

app.use('*', cors());

const TEST_EMAIL = 'earlyoonj@gmail.com';

const WILDERSNAILCOFFEE_DISCOUNT_IDS = [
  7082155933744, 7082155966512, 7082156032048, 7082156130352, 7082156195888,
  7082156261424, 7082156294192, 8134116507957, 8134118867253, 8233508471093,
  8807683948853, 8807686275381, 9949616963893, 10075739423029,
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
  const { email, postalCode, lineItems, customer, isPickup, note } =
    await c.req.json();

  const MILDA_DISCOUNT =
    email === 'milldabakery@gmail.com'
      ? {
          description: 'Milda 100% Off',
          value: '100.0',
          value_type: 'percentage',
        }
      : undefined;

  const PM_TABLEWARE_DISCOUNT =
    email === 'pm@cmarket.ca' &&
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
    email === 'pm@cmarket.ca' &&
    lineItems.every((item: any) => item.vendor === 'PM')
      ? {
          description: 'PM Products 100% Off',
          value: '100.0',
          value_type: 'percentage',
        }
      : undefined;

  const HQ_DISCOUNT =
    email === 'ordercmarket@gmail.com' &&
    lineItems.every((item: any) => item.vendor === 'HQ')
      ? {
          description: 'HQ Products 100% Off',
          value: '100.0',
          value_type: 'percentage',
        }
      : undefined;

  const CMARKET_5_DISCOUNT = CMARKET_5_DISCOUNT_EMAILS.includes(email)
    ? {
        description: '5% Off for CMarket',
        value: '5.0',
        value_type: 'percentage',
      }
    : undefined;

  const wilderSnailCoffeeDiscountItems = lineItems.filter((item: any) =>
    WILDERSNAILCOFFEE_DISCOUNT_IDS.includes(item.product_id)
  );

  const WILDERSNAILCOFFEE_DISCOUNT =
    (email === 'woochanp@gmail.com' || email === TEST_EMAIL) &&
    !!wilderSnailCoffeeDiscountItems.length
      ? {
          description: 'WilderSnailCoffee 2$ Off',
          value: (
            wilderSnailCoffeeDiscountItems.reduce(
              (acc: number, curr: any) => acc + curr.quantity,
              0
            ) * 2
          ).toFixed(2),
          value_type: 'amount',
        }
      : undefined;

  const prefix = postalCode.slice(0, 3).toUpperCase();
  const zoneInfo = getShippingZone(prefix);

  if (!isPickup && !zoneInfo) {
    return c.json(
      {
        error:
          'BC 내의 정확한 우편번호를 기재해주세요\nPlease enter valid ZIP code in BC.',
      },
      422
    );
  }

  let shippingFee = 0;
  if (!isPickup && !CMARKET_FREE_SHIPPING_EMAILS.includes(email) && zoneInfo) {
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
      line_items: lineItems,
      shipping_line: {
        title: isPickup
          ? 'Pickup'
          : CMARKET_FREE_SHIPPING_EMAILS.includes(email)
          ? 'Free Shipping for CMarket'
          : (+shippingFee === 0 ? 'Free' : zoneInfo?.zone) +
            ' Shipping' +
            (+shippingFee === 0
              ? ' (over ' + zoneInfo?.minimumOrder + ')'
              : ''),
        price: isPickup ? 0 : shippingFee,
      },
      applied_discount:
        MILDA_DISCOUNT ||
        HQ_DISCOUNT ||
        PM_PRODUCT_DISCOUNT ||
        PM_TABLEWARE_DISCOUNT ||
        CMARKET_5_DISCOUNT ||
        WILDERSNAILCOFFEE_DISCOUNT,
      customer: customer ? { id: customer.id } : undefined,
      use_customer_default_address: true,
      note,
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

    return c.json({
      id: data.draft_order.id,
      invoiceUrl: data.draft_order.invoice_url,
    });
  } catch (err: any) {
    console.error(err);
    return c.json({ error: 'Failed to create draft order.' }, 500);
  }
});

app.put('/complete-draft-order', async (c) => {
  const { id } = await c.req.json();

  const { SHOP, SHOPIFY_ADMIN_API_TOKEN } = env(c);

  const resp = await fetch(
    `https://${SHOP}/admin/api/2025-04/draft_orders/${id}/complete.json`,
    {
      method: 'PUT',
      body: JSON.stringify({
        payment_pending: true,
      }),
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN as string,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error('Shopify API Error Response:', errorText);
    return c.json({ error: `Shopify error: ${errorText}` }, 500);
  }

  return c.json({ message: '주문이 완료되었습니다.\nOrder completed.' });
});

app.get('/api/check-draft-status', async (c) => {
  const draftId = c.req.query('draftId');
  if (!draftId) return c.json({ error: 'Missing draftId' }, 400);

  const { SHOP, SHOPIFY_ADMIN_API_TOKEN } = env(c);

  const response = await fetch(
    `https://${SHOP}/admin/api/2024-10/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN as string,
      },
      body: JSON.stringify({
        query: `
        query {
          draftOrder(id: "gid://shopify/DraftOrder/${draftId}") {
            status
          }
        }
      `,
      }),
    }
  );

  const result: any = await response.json();
  const status = result?.data?.draftOrder?.status;

  return c.json({ completed: status === 'completed' });
});

export default app;
