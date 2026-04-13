export const STRIPE_PRICES = {
  individual: {
    monthly: process.env.STRIPE_PRICE_INDIVIDUAL_MONTHLY || '',
    yearly: process.env.STRIPE_PRICE_INDIVIDUAL_YEARLY || '',
  },
  professional: {
    monthly: process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY || '',
    yearly: process.env.STRIPE_PRICE_PROFESSIONAL_YEARLY || '',
  },
} as const

export const SUBSCRIPTION_TIERS = {
  free: {
    name: 'Free',
    price: 0,
    features: [
      'Search the database',
      'View basic profile info',
      'See aggregate campaign finance totals',
    ],
  },
  individual: {
    name: 'Individual',
    monthlyPrice: 9.99,
    yearlyPrice: 99,
    features: [
      'Full access to all profiles',
      'Complete campaign finance detail',
      'Relationship constellation maps',
      'Ethics disclosures and PUC records',
      'All linked reporting',
      'Timeline view',
    ],
  },
  professional: {
    name: 'Professional',
    monthlyPrice: 29.99,
    yearlyPrice: 299,
    features: [
      'Everything in Individual',
      'API access (REST, JSON)',
      'CSV export of search results',
      'Email alerts on tracked profiles',
      'Priority access to new profiles',
    ],
  },
  institutional: {
    name: 'Institutional',
    price: 'Custom',
    features: [
      'Everything in Professional',
      'Multiple seats',
      'Custom data requests',
      'SLA',
    ],
  },
} as const
