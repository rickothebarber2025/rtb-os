begin;

-- Remove confirmed staff + one extra admin login so they can resign up
-- clean and land correctly via the new auto-provisioning trigger.
-- Cascades: their sessions/identities/tokens are removed with them,
-- their user_profiles row is removed (CASCADE), and any audit columns
-- elsewhere (created_by, decided_by, etc.) are set to NULL rather than
-- deleting the records those columns point to.

delete from auth.users where email in (
  'rtbbeautylounge@gmail.com',
  'daniel.ndayishiruye@gmail.com',
  'darrylachybrou@gmail.com',
  'wavyboy2457@gmail.com',
  'stephbelle2024@gmail.com',
  'sstylezs203@gmail.com',
  'florymuka321@gmail.com',
  'teilaerharuyi06@gmail.com',
  'nbdrisk23@gmail.com',
  'ronindagiye@gmail.com'
);

commit;;
