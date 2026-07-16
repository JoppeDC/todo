import { useMemo, useState } from 'react'

function App() {
  const [todos, setTodos] = useState([])
  const [newTodo, setNewTodo] = useState('')
  const [filter, setFilter] = useState('all')

  const activeCount = useMemo(
    () => todos.filter((todo) => !todo.completed).length,
    [todos],
  )

  const visibleTodos = todos.filter((todo) => {
    if (filter === 'all') return true
    return filter === 'open' ? !todo.completed : todo.completed
  })

  function addTodo(event) {
    event.preventDefault()
    const text = newTodo.trim()
    if (!text) return

    setTodos((current) => [
      { id: crypto.randomUUID(), text, completed: false },
      ...current,
    ])
    setNewTodo('')
  }

  function toggleTodo(id) {
    setTodos((current) =>
      current.map((todo) =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo,
      ),
    )
  }

  function deleteTodo(id) {
    setTodos((current) => current.filter((todo) => todo.id !== id))
  }

  function clearCompleted() {
    setTodos((current) => current.filter((todo) => !todo.completed))
  }

  return (
    <main className="app-shell">
      <section className="todo-card" aria-labelledby="page-title">
        <header className="card-header">
          <div>
            <p className="eyebrow">A small space for today</p>
            <h1 id="page-title">Little list</h1>
          </div>
          <span className="sun" aria-hidden="true">✦</span>
        </header>

        <form className="new-todo" onSubmit={addTodo}>
          <label className="sr-only" htmlFor="new-todo">Add a task</label>
          <input
            id="new-todo"
            value={newTodo}
            onChange={(event) => setNewTodo(event.target.value)}
            placeholder="What needs your attention?"
            autoComplete="off"
          />
          <button type="submit">Add</button>
        </form>

        <div className="list-toolbar">
          <p>{activeCount === 1 ? '1 thing left' : `${activeCount} things left`}</p>
          <div className="filters" aria-label="Filter tasks">
            {[
              ['all', 'All'],
              ['open', 'Open'],
              ['finished', 'Finished'],
            ].map(([value, label]) => (
              <button
                className={filter === value ? 'selected' : ''}
                key={value}
                type="button"
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <ul className="todo-list" aria-live="polite">
          {visibleTodos.map((todo) => (
            <li className={todo.completed ? 'completed' : ''} key={todo.id}>
              <label>
                <input
                  type="checkbox"
                  checked={todo.completed}
                  onChange={() => toggleTodo(todo.id)}
                />
                <span className="checkmark" aria-hidden="true">✓</span>
                <span className="todo-text">{todo.text}</span>
              </label>
              <button
                className="delete"
                type="button"
                aria-label={`Delete ${todo.text}`}
                onClick={() => deleteTodo(todo.id)}
              >
                ×
              </button>
            </li>
          ))}
          {visibleTodos.length === 0 && (
            <li className="empty-state">Nothing here — enjoy the breathing room.</li>
          )}
        </ul>

        {todos.some((todo) => todo.completed) && (
          <button className="clear" type="button" onClick={clearCompleted}>
            Clear completed
          </button>
        )}
      </section>
      <p className="privacy-note">Nothing is saved. This list lives only while this page is open.</p>
    </main>
  )
}

export default App
