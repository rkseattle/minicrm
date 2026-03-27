/**
 * OwnerSelect component.
 * Reusable select for assigning an owner from a list of active users.
 * Used by ContactForm and AccountForm.
 */

import { Select } from '@/components/ui/Select.js';
import type { ActiveUser } from '@/api/users.js';
import type { SelectHTMLAttributes } from 'react';

interface OwnerSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  /** Label text rendered above the select */
  label: string;
  /** List of active users to populate the options */
  users: ActiveUser[];
  /** HTML id for label association */
  id: string;
  /**
   * Fallback label shown as a disabled option when the current value does not
   * match any user in the list (e.g. the owner has been deactivated).
   * Keeps the unknown UUID in state so it is not silently overwritten.
   */
  unknownLabel: string;
}

/**
 * Renders a <select> populated with active users for owner assignment.
 * When the controlled value does not match any active user, a disabled
 * placeholder option is prepended so the browser does not silently display
 * the first active user instead.
 *
 * @param label - Label text rendered above the select
 * @param users - Active users to display as options
 * @param id - HTML id used to associate the label with the select element
 * @param unknownLabel - Text shown when the current owner is not in the active users list
 */
export default function OwnerSelect({
  label,
  users,
  id,
  unknownLabel,
  ...props
}: OwnerSelectProps) {
  const currentValue = props.value as string | undefined;
  const valueInList = users.some((u) => u.id === currentValue);
  const showUnknownOption = Boolean(currentValue) && !valueInList;

  return (
    <Select id={id} label={label} {...props}>
      {showUnknownOption && (
        <option value={currentValue} disabled>
          {unknownLabel}
        </option>
      )}
      {users.map((user) => (
        <option key={user.id} value={user.id}>
          {user.name}
        </option>
      ))}
    </Select>
  );
}
