import { greetingProblem } from '../../domain/greeting';
import type { Business } from '../../domain/types';
import { ServiceError, type Deps } from './deps';

/** Saves the owner's outgoing message; the next caller hears it. */
export function saveGreeting(deps: Deps, greeting: string): Business {
  const problem = greetingProblem(greeting);
  if (problem) throw new ServiceError(422, 'bad-greeting', problem);
  return deps.store.update((db) => {
    db.business.greeting = greeting.trim().replace(/\s+/g, ' ');
    return { ...db.business };
  });
}
