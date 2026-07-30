import { useEffect, useMemo, useRef, useState } from 'react'
import { forgetTodos, hasSavedTodos, saveTodos, unlockTodos } from './encryptedStorage.js'

function App() {
  const [todos, setTodos] = useState([])
  const [newTodo, setNewTodo] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [hasSavedList, setHasSavedList] = useState(hasSavedTodos)
  const [unlockError, setUnlockError] = useState('')
  const [isUnlocking, setIsUnlocking] = useState(false)
  const encryption = useRef(null)
  const writeQueue = useRef(Promise.resolve())

  const activeCount = useMemo(() => todos.filter((todo) => !todo.completed).length, [todos])

  useEffect(() => {
    if (!isUnlocked || !encryption.current) return
    const { key, salt } = encryption.current
    writeQueue.current = writeQueue.current
      .catch(() => undefined)
      .then(() => saveTodos(todos, key, salt))
      .catch(() => setUnlockError('Your changes could not be saved.'))
  }, [todos, isUnlocked])

  function updateTodos(updater) {
    setTodos(updater)
  }

  function addTodo(event) {
    event.preventDefault()
    const text = newTodo.trim()
    if (!text) return
    updateTodos((current) => [{ id: crypto.randomUUID(), text, completed: false }, ...current])
    setNewTodo('')
  }

  function toggleTodo(id) {
    updateTodos((current) => current.map((todo) => todo.id === id ? { ...todo, completed: !todo.completed } : todo))
  }

  function deleteTodo(id) {
    updateTodos((current) => current.filter((todo) => todo.id !== id))
  }

  function clearCompleted() {
    updateTodos(() => [])
  }

  async function unlock(event) {
    event.preventDefault()
    if (!passphrase) return
    setIsUnlocking(true)
    setUnlockError('')
    try {
      const unlocked = await unlockTodos(passphrase)
      encryption.current = unlocked
      setTodos(unlocked.todos)
      setIsUnlocked(true)
      setPassphrase('')
      setHasSavedList(true)
    } catch (error) {
      setUnlockError(error.message)
    } finally {
      setIsUnlocking(false)
    }
  }

  function startOver() {
    forgetTodos()
    encryption.current = null
    setTodos([])
    setHasSavedList(false)
    setUnlockError('Saved data removed. Choose a new passphrase to start again.')
  }

  if (!isUnlocked) {
    return (
      <main className="app-shell">
        <section className="todo-card unlock-card" aria-labelledby="page-title">
          <header className="card-header"><div><p className="eyebrow">Private in your browser</p><h1 id="page-title">Little list</h1></div><span className="sun" aria-hidden="true">✦</span></header>
          <form className="new-todo unlock-form" onSubmit={unlock}>
            <label htmlFor="passphrase">{hasSavedList ? 'Enter your passphrase to unlock your list.' : 'Choose a passphrase to protect your new list.'}</label>
            <input id="passphrase" type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="current-password" required minLength="8" />
            <button type="submit" disabled={isUnlocking}>{isUnlocking ? 'Unlocking…' : hasSavedList ? 'Unlock' : 'Create list'}</button>
          </form>
          {unlockError && <p className="unlock-error" role="alert">{unlockError}</p>}
          {hasSavedList && <button className="clear forget" type="button" onClick={startOver}>Forget saved list</button>}
        </section>
        <p className="privacy-note">Your list is encrypted before it is saved in this browser. Keep your passphrase safe: it cannot be recovered.</p>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <section className="todo-card" aria-labelledby="page-title">
        <header className="card-header"><div><p className="eyebrow">A small space for today</p><h1 id="page-title">Little list</h1></div><span className="sun" aria-hidden="true">✦</span></header>
        <form className="new-todo" onSubmit={addTodo}><label className="sr-only" htmlFor="new-todo">Add a task</label><input id="new-todo" value={newTodo} onChange={(event) => setNewTodo(event.target.value)} placeholder="What needs your attention?" autoComplete="off" /><button type="submit">Add</button></form>
        <div className="list-toolbar"><p>{activeCount === 1 ? '1 thing left' : `${activeCount} things left`}</p></div>
        <ul className="todo-list" aria-live="polite">
          {todos.map((todo) => <li className={todo.completed ? 'completed' : ''} key={todo.id}><label><input type="checkbox" checked={todo.completed} onChange={() => toggleTodo(todo.id)} /><span className="checkmark" aria-hidden="true">✓</span><span className="todo-text">{todo.text}</span></label><button className="delete" type="button" aria-label={`Delete ${todo.text}`} onClick={() => deleteTodo(todo.id)}>×</button></li>)}
          {todos.length === 0 && <li className="empty-state">Nothing here — enjoy the breathing room.</li>}
        </ul>
        {todos.some((todo) => todo.completed) && <button className="clear" type="button" onClick={clearCompleted}>Clear completed</button>}
      </section>
      <p className="privacy-note">Your list is encrypted before it is saved in this browser.</p>
    </main>
  )
}

export default App
