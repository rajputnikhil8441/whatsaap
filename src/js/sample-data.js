// Used ONLY when Supabase is not configured (local preview). Clearly fictional:
// the numbers are in the reserved 555-01xx range and there are no logos.
export const SAMPLE_BRANDS = [
  {
    id: 's1', slug: 'sample-brand-one', name: 'Sample Brand One (demo)',
    description: 'SAMPLE DATA - placeholder brand. Replace with a real brand in the admin panel.',
    logo_path: null, backup_type: 'email', backup_value: 'support@example.com', updated_at: '2000-01-01T00:00:00Z',
    contacts: [
      { id: 'c1', category: 'customer_support', label: 'Sample agent', phone: '15550100101', sort_order: 1 },
      { id: 'c2', category: 'deposits', label: 'Sample deposits', phone: '15550100102', sort_order: 2 },
      { id: 'c3', category: 'withdrawals', label: 'Sample payouts', phone: '15550100103', sort_order: 3 },
    ],
  },
  {
    id: 's2', slug: 'sample-brand-two', name: 'Sample Brand Two (demo)',
    description: 'SAMPLE DATA - placeholder brand. Replace with a real brand in the admin panel.',
    logo_path: null, backup_type: 'telegram', backup_value: 'sample_support_demo', updated_at: '2000-01-01T00:00:00Z',
    contacts: [
      { id: 'c4', category: 'customer_support', label: 'Sample agent', phone: '15550100201', sort_order: 1 },
      { id: 'c5', category: 'general', label: 'Sample general', phone: '15550100202', sort_order: 2 },
    ],
  },
];
