'use client'

import { useState, createContext, useContext } from 'react'

interface TabsContextType {
  activeTab: string
  setActiveTab: (tab: string) => void
}

const TabsContext = createContext<TabsContextType>({ activeTab: '', setActiveTab: () => {} })

interface TabsProps {
  defaultTab: string
  children: React.ReactNode
  className?: string
}

export function Tabs({ defaultTab, children, className = '' }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab)
  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  )
}

export function TabList({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex gap-1 border-b border-white/10 ${className}`}>
      {children}
    </div>
  )
}

export function Tab({ value, children }: { value: string; children: React.ReactNode }) {
  const { activeTab, setActiveTab } = useContext(TabsContext)
  const isActive = activeTab === value
  return (
    <button
      onClick={() => setActiveTab(value)}
      className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
        isActive
          ? 'text-gold border-gold'
          : 'text-white/50 border-transparent hover:text-white/70 hover:border-white/20'
      }`}
    >
      {children}
    </button>
  )
}

export function TabPanel({ value, children }: { value: string; children: React.ReactNode }) {
  const { activeTab } = useContext(TabsContext)
  if (activeTab !== value) return null
  return <div className="py-4">{children}</div>
}
