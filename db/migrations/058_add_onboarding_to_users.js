/**
 * Migration 058: Add per-user onboarding columns to users table.
 *
 * Moves checklist completion from system_settings (shared) to users (per-user),
 * enabling role-specific checklists and admin-initiated resets per user.
 */
exports.up = async (pgm) => {
  pgm.addColumns('users', {
    onboarding_completed: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    onboarding_completed_at: {
      type: 'timestamptz',
      notNull: false,
    },
  });
};

exports.down = async (pgm) => {
  pgm.dropColumns('users', ['onboarding_completed', 'onboarding_completed_at']);
};
