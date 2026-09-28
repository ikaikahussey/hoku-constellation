'use client'

import { useState, createContext, useContext, useId } from 'react'

interface TabsContextType { activeTab: string; setActiveTab: (tab: string) => void; baseId: string }
const TabsContext = createContext<TabsContextType>({ activeTab: '', setActiveTab: () => {}, baseId: '' })

export function Tabs({ defaultTab, children, className = '' }: { defaultTab: string; children: React.ReactNode; className?: string }) {
  const [activeTab, setActiveTab] = useState(defaultTab)
  const baseId = useId()
  return <TabsContext.Provider value={{ activeTab, setActiveTab, baseId }}><div className={className}>{children}</div></TabsContext.Provider>
}

export function TabList({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div role="tablist" className={`flex gap-1 border-b border-ink overflow-x-auto ${className}`}>{children}</div>
}

export function Tab({ value, children }: { value: string; children: React.ReactNode }) {
  const { activeTab, setActiveTab, baseId } = useContext(TabsContext)
  const isActive = activeTab === value
  return (
    <button
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-selected={isActive}
      aria-controls={`${baseId}-panel-${value}`}
      onClick={() => setActiveTab(value)}
      className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px whitespace-nowrap ${isActive ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
    >
      {children}
    </button>
  )
}

export function TabPanel({ value, children }: { value: string; children: React.ReactNode }) {
  const { activeTab, baseId } = useContext(TabsContext)
  if (activeTab !== value) return null
  return <div role="tabpanel" id={`${baseId}-panel-${value}`} aria-labelledby={`${baseId}-tab-${value}`} className="py-4">{children}</div>
}
