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
}

/**
 * Renders a <select> populated with active users for owner assignment.
 * The value should be the owner's UUID; an empty string means no selection.
 *
 * @param label - Label text rendered above the select
 * @param users - Active users to display as options
 * @param id - HTML id used to associate the label with the select element
 */
export default function OwnerSelect({ label, users, id, ...props }: OwnerSelectProps) {
  return (
    <Select id={id} label={label} {...props}>
      {users.map((user) => (
        <option key={user.id} value={user.id}>
          {user.name}
        </option>
      ))}
    </Select>
  );
}
