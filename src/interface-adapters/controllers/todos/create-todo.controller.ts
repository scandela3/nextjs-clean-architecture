import { z } from 'zod';

import { createTodoUseCase } from '@/src/application/use-cases/todos/create-todo.use-case';
import { UnauthenticatedError } from '@/src/entities/errors/auth';
import { InputParseError } from '@/src/entities/errors/common';
import { Todo } from '@/src/entities/models/todo';
import { ServiceFactory } from '@/ioc/service-factory';

function presenter(todos: Todo[]) {
  return ServiceFactory.getInstrumentationService().startSpan(
    { name: 'createTodo Presenter', op: 'serialize' },
    () => {
      return todos.map((todo) => ({
        id: todo.id,
        todo: todo.todo,
        userId: todo.userId,
        completed: todo.completed,
      }));
    }
  );
}

const inputSchema = z.object({ todo: z.string().min(1) });

export async function createTodoController(
  input: Partial<z.infer<typeof inputSchema>>,
  sessionId: string | undefined
): Promise<ReturnType<typeof presenter>> {
  return await ServiceFactory.getInstrumentationService().startSpan(
    {
      name: 'createTodo Controller',
    },
    async () => {
      if (!sessionId) {
        throw new UnauthenticatedError('Must be logged in to create a todo');
      }
      const authenticationService = ServiceFactory.getAuthenticationService();
      const { user } = await authenticationService.validateSession(sessionId);

      const { data, error: inputParseError } = inputSchema.safeParse(input);

      if (inputParseError) {
        throw new InputParseError('Invalid data', { cause: inputParseError });
      }

      const todosFromInput = data.todo.split(',').map((t) => t.trim());

      const transactionManagerService =
        ServiceFactory.getTransactionManagerService();
      const todos = await ServiceFactory.getInstrumentationService().startSpan(
        { name: 'Create Todo Transaction' },
        async () =>
          transactionManagerService.startTransaction(async (tx) => {
            try {
              return await Promise.all(
                todosFromInput.map((t) =>
                  createTodoUseCase({ todo: t }, user.id, tx)
                )
              );
            } catch (err) {
              console.error('Rolling back!');
              tx.rollback();
            }
          })
      );
      return presenter(todos ?? []);
    }
  );
}
