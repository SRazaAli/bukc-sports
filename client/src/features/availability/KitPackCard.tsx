/**
 * KitPackCard — shown on AvailabilityScreen when a sport filter is active.
 *
 * Students see it as a browsable "full kit" summary with a link to My Borrows
 * (where they can actually request the kit — borrow action is gated away from
 * the availability checker per EQUIP-AVAIL-09).
 *
 * Staff (SUPER_ADMIN / COORDINATOR) see it as a read-only summary with no
 * borrow CTA.
 */
import { useNavigate } from 'react-router-dom';
import type { KitPack } from './kitPackApi.js';

interface Props {
  pack: KitPack;
  isStudent: boolean;
}

export function KitPackCard({ pack, isStudent }: Props) {
  const navigate = useNavigate();

  const kitBadgeStyle: React.CSSProperties =
    pack.kitStatusBadge === 'AVAILABLE'
      ? { ...badgeBase, backgroundColor: '#d1fae5', color: '#065f46' }
      : pack.kitStatusBadge === 'PARTIAL'
      ? { ...badgeBase, backgroundColor: '#fef3c7', color: '#92400e' }
      : { ...badgeBase, backgroundColor: '#fee2e2', color: '#991b1b' };

  const kitBadgeText =
    pack.kitStatusBadge === 'AVAILABLE'
      ? 'All Available'
      : pack.kitStatusBadge === 'PARTIAL'
      ? 'Partially Available'
      : 'Unavailable';

  return (
    <div style={card}>
      {/* Header */}
      <div style={header}>
        <div style={headerLeft}>
          <span style={kitIcon}>🎒</span>
          <div>
            <h2 style={title}>{pack.sportCategoryName} Kit Pack</h2>
            <p style={subtitle}>Complete set · {pack.items.length} item{pack.items.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <span style={kitBadgeStyle}>{kitBadgeText}</span>
      </div>

      {/* Item list */}
      <div style={itemGrid}>
        {pack.items.map((item) => {
          const itemBadge: React.CSSProperties =
            item.statusBadge === 'AVAILABLE'
              ? { ...itemBadgeBase, backgroundColor: '#d1fae5', color: '#065f46' }
              : item.statusBadge === 'LOW_STOCK'
              ? { ...itemBadgeBase, backgroundColor: '#fef3c7', color: '#92400e' }
              : { ...itemBadgeBase, backgroundColor: '#fee2e2', color: '#991b1b' };
          const itemBadgeText =
            item.statusBadge === 'AVAILABLE' ? 'Available' : item.statusBadge === 'LOW_STOCK' ? 'Low Stock' : 'Checked Out';

          return (
            <div key={item.equipmentTypeId} style={itemRow}>
              {/* Thumbnail */}
              <div style={thumb}>
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt=""
                    style={thumbImg}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div style={thumbPlaceholder}>{item.name.charAt(0)}</div>
                )}
              </div>
              <div style={itemBody}>
                <span style={itemName}>{item.name}</span>
                <span style={itemMeta}>{item.lendingUnit === 'PAIR' ? 'Pair' : 'Single'} · {item.availableUnits} available</span>
              </div>
              <span style={itemBadge}>{itemBadgeText}</span>
            </div>
          );
        })}
      </div>

      {/* CTA — students only, per EQUIP-AVAIL-09 the availability screen is read-only */}
      {isStudent && (
        <div style={footer}>
          <p style={ctaNote}>
            {pack.kitStatusBadge === 'AVAILABLE'
              ? 'All items are ready. Go to My Borrows to request the full kit.'
              : pack.kitStatusBadge === 'PARTIAL'
              ? 'Some items are unavailable. You can still request individual items in My Borrows.'
              : 'No items are currently available for this kit.'}
          </p>
          <button
            style={pack.canRequestAll ? ctaBtn : ctaBtnDisabled}
            onClick={() =>
              navigate('/my-borrows', {
                state: {
                  kitPack: {
                    sportCategoryId: pack.sportCategoryId,
                    sportCategoryName: pack.sportCategoryName,
                    canRequestAll: pack.canRequestAll,
                  },
                },
              })
            }
          >
            {pack.canRequestAll ? `Request Full ${pack.sportCategoryName} Kit →` : 'View in My Borrows →'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--color-surface, #fff)',
  border: '1px solid var(--color-border, #e5e7eb)',
  borderRadius: 12,
  padding: '20px 24px',
  marginBottom: 24,
  boxShadow: '0 2px 12px rgba(37,99,235,0.08)',
};

const header: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 16,
  gap: 12,
  flexWrap: 'wrap',
};

const headerLeft: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const kitIcon: React.CSSProperties = {
  fontSize: 32,
  lineHeight: 1,
};

const title: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 700,
  color: 'var(--color-text, #111)',
};

const subtitle: React.CSSProperties = {
  margin: '2px 0 0',
  fontSize: 13,
  color: 'var(--color-muted, #6b7280)',
};

const badgeBase: React.CSSProperties = {
  display: 'inline-block',
  padding: '4px 10px',
  borderRadius: 20,
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const itemGrid: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  marginBottom: 16,
};

const itemRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 12px',
  background: 'var(--color-surface-alt, #f9fafb)',
  borderRadius: 8,
};

const thumb: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 6,
  overflow: 'hidden',
  flexShrink: 0,
};

const thumbImg: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

const thumbPlaceholder: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 6,
  background: 'var(--color-accent, #2563eb)',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 16,
  fontWeight: 700,
};

const itemBody: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const itemName: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--color-text, #111)',
};

const itemMeta: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-muted, #6b7280)',
};

const itemBadgeBase: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 12,
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const footer: React.CSSProperties = {
  borderTop: '1px solid var(--color-border, #e5e7eb)',
  paddingTop: 14,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
};

const ctaNote: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: 'var(--color-muted, #6b7280)',
  flex: 1,
};

const ctaBtn: React.CSSProperties = {
  padding: '9px 18px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--color-accent, #2563eb)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const ctaBtnDisabled: React.CSSProperties = {
  ...ctaBtn,
  background: 'var(--color-muted, #6b7280)',
  cursor: 'default',
};
