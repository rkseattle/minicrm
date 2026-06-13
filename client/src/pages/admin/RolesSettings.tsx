/**
 * RolesSettings — Custom role management panel for MINCRM-542 capability RBAC.
 * Admin only (settings:manage capability required).
 *
 * Features:
 * - List all custom roles with their capability counts
 * - Create a new custom role via an inline form
 * - Edit an existing custom role's name, description, and capabilities
 * - Delete non-built-in roles (with guard against roles with active assignees)
 * - View capabilities for built-in roles via a read-only inline panel (MINCRM-547)
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  listCustomRoles,
  createCustomRole,
  updateCustomRole,
  deleteCustomRole,
  CUSTOM_ROLES_QUERY_KEY,
  type CustomRoleResponse,
} from '@/api/customRoles.js';
import { Capability } from '@shared/schemas/capabilitySchema.js';
import { Button } from '@/components/ui/Button.js';

// ── Capability grouping for the capability picker ─────────────────────────────

// groupKey maps to rolesSettings.capabilityGroups.<key> in locale files (MINCRM-544)
const CAPABILITY_GROUPS: Array<{ groupKey: string; caps: Capability[] }> = [
  {
    groupKey: 'contacts',
    caps: [
      Capability.ContactsView,
      Capability.ContactsCreate,
      Capability.ContactsEdit,
      Capability.ContactsDelete,
      Capability.ContactsExport,
    ],
  },
  {
    groupKey: 'deals',
    caps: [
      Capability.DealsView,
      Capability.DealsCreate,
      Capability.DealsEdit,
      Capability.DealsDelete,
      Capability.DealsReassign,
    ],
  },
  {
    groupKey: 'activities',
    caps: [
      Capability.ActivitiesView,
      Capability.ActivitiesCreate,
      Capability.ActivitiesEdit,
      Capability.ActivitiesDelete,
    ],
  },
  {
    groupKey: 'pipelines',
    caps: [Capability.PipelinesView, Capability.PipelinesManage],
  },
  {
    groupKey: 'reports',
    caps: [
      Capability.ReportsView,
      Capability.ReportsCreate,
      Capability.ReportsEdit,
      Capability.ReportsDelete,
      Capability.ReportsExport,
      Capability.ReportsSchedule,
    ],
  },
  {
    groupKey: 'data',
    caps: [Capability.DataImport, Capability.DataExport],
  },
  {
    groupKey: 'usersAdmin',
    caps: [
      Capability.UsersView,
      Capability.UsersCreate,
      Capability.UsersEdit,
      Capability.UsersDelete,
      Capability.TeamsManage,
      Capability.IntegrationsManage,
      Capability.SettingsManage,
      Capability.FeatureFlagsManage,
      Capability.AuditLogView,
    ],
  },
  {
    groupKey: 'api',
    caps: [Capability.ApiAccess],
  },
];

/**
 * Returns a fully-qualified label for a capability checkbox: "Namespace: Action"
 * e.g. contacts:view → "Contacts: View", feature_flags:manage → "Feature Flags: Manage".
 * Consistent across all groups; eliminates duplicate action names within a group (MINCRM-544).
 */
function capabilityLabel(
  cap: Capability,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const [ns, action] = cap.split(':');
  const nsLabel = t(`rolesSettings.capabilityNamespaces.${ns ?? cap}`, { defaultValue: ns ?? cap });
  const actionLabel = t(`rolesSettings.capabilityActions.${action ?? cap}`, {
    defaultValue: action ?? cap,
  });
  return `${nsLabel}: ${actionLabel}`;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

interface CapabilityPickerProps {
  selected: Set<Capability>;
  onChange: (caps: Set<Capability>) => void;
  disabled?: boolean;
}

function CapabilityPicker({ selected, onChange, disabled }: CapabilityPickerProps) {
  const { t } = useTranslation();

  function toggle(cap: Capability) {
    const next = new Set(selected);
    if (next.has(cap)) {
      next.delete(cap);
    } else {
      next.add(cap);
    }
    onChange(next);
  }

  function toggleGroup(caps: Capability[]) {
    const allSelected = caps.every((c) => selected.has(c));
    const next = new Set(selected);
    if (allSelected) {
      caps.forEach((c) => next.delete(c));
    } else {
      caps.forEach((c) => next.add(c));
    }
    onChange(next);
  }

  return (
    <div className="space-y-5" data-testid="capability-picker">
      {CAPABILITY_GROUPS.map((group, groupIndex) => {
        const allSelected = group.caps.every((c) => selected.has(c));
        const someSelected = !allSelected && group.caps.some((c) => selected.has(c));
        const groupLabel = t(`rolesSettings.capabilityGroups.${group.groupKey}`);
        return (
          <div
            key={group.groupKey}
            className={groupIndex > 0 ? 'border-t border-gray-100 pt-4' : undefined}
          >
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={() => toggleGroup(group.caps)}
                disabled={disabled}
                data-testid={`capability-group-${group.groupKey}`}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm font-semibold text-gray-800">{groupLabel}</span>
            </label>
            <div className="ps-6 grid grid-cols-3 gap-x-4 gap-y-2">
              {group.caps.map((cap) => {
                const isChecked = selected.has(cap);
                return (
                  <label
                    key={cap}
                    className={`flex items-center gap-2 rounded px-2 py-1 cursor-pointer transition-colors ${
                      isChecked ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggle(cap)}
                      disabled={disabled}
                      data-testid={`capability-checkbox-${cap}`}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 shrink-0"
                    />
                    <span className="text-sm text-gray-700 select-none">
                      {capabilityLabel(cap, t)}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface CapabilityReadOnlyListProps {
  capabilities: Capability[];
}

function CapabilityReadOnlyList({ capabilities }: CapabilityReadOnlyListProps) {
  const { t } = useTranslation();
  const granted = new Set(capabilities);

  return (
    <div className="space-y-5" data-testid="capability-readonly-list">
      {CAPABILITY_GROUPS.map((group, groupIndex) => {
        const groupLabel = t(`rolesSettings.capabilityGroups.${group.groupKey}`);
        return (
          <div
            key={group.groupKey}
            className={groupIndex > 0 ? 'border-t border-gray-100 pt-4' : undefined}
          >
            <label className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                checked={group.caps.every((c) => granted.has(c))}
                disabled
                data-testid={`readonly-capability-group-${group.groupKey}`}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600"
              />
              <span className="text-sm font-semibold text-gray-800">{groupLabel}</span>
            </label>
            <div className="ps-6 grid grid-cols-3 gap-x-4 gap-y-2">
              {group.caps.map((cap) => {
                const isGranted = granted.has(cap);
                return (
                  <label
                    key={cap}
                    className={`flex items-center gap-2 rounded px-2 py-1 ${
                      isGranted ? 'bg-indigo-50 ring-1 ring-indigo-200' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isGranted}
                      disabled
                      data-testid={`readonly-capability-checkbox-${cap}`}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 shrink-0"
                    />
                    <span className="text-sm text-gray-700 select-none">
                      {capabilityLabel(cap, t)}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface RoleFormProps {
  initial?: CustomRoleResponse;
  onSave: (data: { name: string; description: string; capabilities: Capability[] }) => void;
  onCancel: () => void;
  isPending: boolean;
}

function RoleForm({ initial, onSave, onCancel, isPending }: RoleFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [selected, setSelected] = useState<Set<Capability>>(new Set(initial?.capabilities ?? []));
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(t('rolesSettings.form.nameRequired'));
      return;
    }
    if (selected.size === 0) {
      setError(t('rolesSettings.form.capabilitiesRequired'));
      return;
    }
    setError('');
    onSave({
      name: name.trim(),
      description: description.trim(),
      capabilities: Array.from(selected),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="role-form">
      <div>
        <label htmlFor="role-name" className="block text-sm font-medium text-gray-700 mb-1">
          {t('rolesSettings.form.nameLabel')}
        </label>
        <input
          id="role-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          disabled={isPending}
          data-testid="role-form-name"
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 disabled:bg-gray-50"
        />
      </div>

      <div>
        <label htmlFor="role-description" className="block text-sm font-medium text-gray-700 mb-1">
          {t('rolesSettings.form.descriptionLabel')}
        </label>
        <input
          id="role-description"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          disabled={isPending}
          data-testid="role-form-description"
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 disabled:bg-gray-50"
        />
      </div>

      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">
          {t('rolesSettings.form.capabilitiesLabel')}
        </p>
        <CapabilityPicker selected={selected} onChange={setSelected} disabled={isPending} />
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert" data-testid="role-form-error">
          {error}
        </p>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending} data-testid="role-form-submit">
          {isPending ? t('rolesSettings.form.saving') : t('rolesSettings.form.saveButton')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={isPending}
          data-testid="role-form-cancel"
        >
          {t('rolesSettings.form.cancelButton')}
        </Button>
      </div>
    </form>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function RolesSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const {
    data: roles,
    isLoading,
    isError,
  } = useQuery({
    queryKey: CUSTOM_ROLES_QUERY_KEY,
    queryFn: listCustomRoles,
  });

  const createMutation = useMutation({
    mutationFn: createCustomRole,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CUSTOM_ROLES_QUERY_KEY });
      setCreating(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: { name: string; description: string; capabilities: Capability[] };
    }) => updateCustomRole(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CUSTOM_ROLES_QUERY_KEY });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCustomRole,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CUSTOM_ROLES_QUERY_KEY });
      setDeleteError(null);
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: { code?: string } } } })?.response
        ?.data?.error?.code;
      if (message === 'CUSTOM_ROLE_HAS_ASSIGNEES') {
        setDeleteError(t('rolesSettings.deleteError.hasAssignees'));
      } else if (message === 'CUSTOM_ROLE_BUILTIN') {
        setDeleteError(t('rolesSettings.deleteError.builtin'));
      } else {
        setDeleteError(t('rolesSettings.deleteError.generic'));
      }
    },
  });

  if (isLoading) {
    return (
      <p className="text-sm text-gray-500" data-testid="roles-settings-loading">
        {t('settings.loading')}
      </p>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-red-600" role="alert" data-testid="roles-settings-error">
        {t('rolesSettings.loadError')}
      </p>
    );
  }

  return (
    <div className="space-y-6" data-testid="roles-settings-panel">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900" data-testid="roles-settings-title">
            {t('rolesSettings.sectionTitle')}
          </h2>
          <p className="mt-1 text-sm text-gray-500">{t('rolesSettings.sectionHint')}</p>
        </div>
        {!creating && !editingId && (
          <Button onClick={() => setCreating(true)} data-testid="roles-settings-new-button">
            {t('rolesSettings.newRoleButton')}
          </Button>
        )}
      </div>

      {deleteError && (
        <p className="text-sm text-red-600" role="alert" data-testid="roles-settings-delete-error">
          {deleteError}
        </p>
      )}

      {creating && (
        <div
          className="border border-gray-200 rounded-lg p-4 bg-white"
          data-testid="roles-settings-create-form"
        >
          <h3 className="text-sm font-semibold text-gray-800 mb-4">
            {t('rolesSettings.form.createTitle')}
          </h3>
          <RoleForm
            onSave={(data) =>
              createMutation.mutate({
                name: data.name,
                description: data.description || undefined,
                capabilities: data.capabilities,
              })
            }
            onCancel={() => setCreating(false)}
            isPending={createMutation.isPending}
          />
          {createMutation.isError && (
            <p
              className="mt-2 text-sm text-red-600"
              role="alert"
              data-testid="roles-settings-create-error"
            >
              {t('rolesSettings.createError')}
            </p>
          )}
        </div>
      )}

      <div className="space-y-3" data-testid="roles-settings-list">
        {roles?.map((role) => (
          <div
            key={role.id}
            className="border border-gray-200 rounded-lg bg-white"
            data-testid={`role-row-${role.id}`}
          >
            {editingId === role.id ? (
              <div className="p-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-4">
                  {t('rolesSettings.form.editTitle')}
                </h3>
                <RoleForm
                  initial={role}
                  onSave={(data) => updateMutation.mutate({ id: role.id, input: data })}
                  onCancel={() => setEditingId(null)}
                  isPending={updateMutation.isPending}
                />
                {updateMutation.isError && (
                  <p
                    className="mt-2 text-sm text-red-600"
                    role="alert"
                    data-testid="roles-settings-update-error"
                  >
                    {t('rolesSettings.updateError')}
                  </p>
                )}
              </div>
            ) : (
              <div>
                <div className="flex items-start justify-between p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-sm font-medium text-gray-900"
                        data-testid={`role-name-${role.id}`}
                      >
                        {role.name}
                      </span>
                      {role.is_builtin && (
                        <span
                          className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
                          data-testid={`role-builtin-badge-${role.id}`}
                        >
                          {t('rolesSettings.builtinBadge')}
                        </span>
                      )}
                    </div>
                    {role.description && (
                      <p
                        className="mt-0.5 text-xs text-gray-500"
                        data-testid={`role-description-${role.id}`}
                      >
                        {role.description}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-gray-400">
                      {t('rolesSettings.capabilityCount', { count: role.capabilities.length })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ms-4 shrink-0">
                    {role.is_builtin ? (
                      <Button
                        variant="secondary"
                        onClick={() => setViewingId((prev) => (prev === role.id ? null : role.id))}
                        data-testid={`role-view-button-${role.id}`}
                      >
                        {t('rolesSettings.viewButton')}
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setEditingId(role.id);
                            setDeleteError(null);
                          }}
                          data-testid={`role-edit-button-${role.id}`}
                        >
                          {t('rolesSettings.editButton')}
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => {
                            setDeleteError(null);
                            deleteMutation.mutate(role.id);
                          }}
                          disabled={deleteMutation.isPending}
                          data-testid={`role-delete-button-${role.id}`}
                        >
                          {t('rolesSettings.deleteButton')}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {role.is_builtin && viewingId === role.id && (
                  <div
                    className="border-t border-gray-100 px-4 pb-4 pt-3"
                    data-testid={`role-capability-panel-${role.id}`}
                  >
                    <p className="mb-3 text-xs text-gray-500 italic">
                      {t('rolesSettings.builtinReadOnlyNotice')}
                    </p>
                    <CapabilityReadOnlyList capabilities={role.capabilities} />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
