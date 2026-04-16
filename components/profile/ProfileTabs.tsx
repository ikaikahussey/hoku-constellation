'use client'

import { Tabs, TabList, Tab, TabPanel } from '@/components/ui/Tabs'

interface ExtraTab {
  value: string
  label: string
  content: React.ReactNode
}

interface ProfileTabsProps {
  overviewContent: React.ReactNode
  connectionsContent: React.ReactNode
  moneyContent: React.ReactNode
  reportingContent: React.ReactNode
  timelineContent: React.ReactNode
  extraTabs?: ExtraTab[]
}

export function ProfileTabs({ overviewContent, connectionsContent, moneyContent, reportingContent, timelineContent, extraTabs }: ProfileTabsProps) {
  return (
    <Tabs defaultTab="overview">
      <TabList>
        <Tab value="overview">Overview</Tab>
        <Tab value="connections">Connections</Tab>
        <Tab value="money">Money</Tab>
        {extraTabs?.map((tab) => (
          <Tab key={tab.value} value={tab.value}>{tab.label}</Tab>
        ))}
        <Tab value="reporting">Reporting</Tab>
        <Tab value="timeline">Timeline</Tab>
      </TabList>
      <TabPanel value="overview">{overviewContent}</TabPanel>
      <TabPanel value="connections">{connectionsContent}</TabPanel>
      <TabPanel value="money">{moneyContent}</TabPanel>
      {extraTabs?.map((tab) => (
        <TabPanel key={tab.value} value={tab.value}>{tab.content}</TabPanel>
      ))}
      <TabPanel value="reporting">{reportingContent}</TabPanel>
      <TabPanel value="timeline">{timelineContent}</TabPanel>
    </Tabs>
  )
}
