import React, { useMemo, useRef } from 'react'
import { withComposerDraft } from './composer-draft-host.jsx'
import { ConversationTools } from './chat-ui.jsx'
import { ContactAttentionNavigation } from './contact-attention.jsx'
import { WebPanelPinsLive } from './web-panel-pins-live.jsx'
import { workspaceNavigation, PRODUCT_PANELS } from './workspace-navigation.mjs'
import { requestWorkbenchView } from '../../.dsh-plugin/client/workbench-state.mjs'
import { openIndependentChat } from './independent-chat-navigation.mjs'
import { WorkspaceShortcuts } from './workspace-shortcuts.jsx'

const emptySource = () => null

/** Native slot identities stay intact so their registration watchers cannot select their own replacement. */
export function createProductSlots(slots,openPanel,productApi,TeamSidebar,client={}){
  const navigate=input=>{workspaceNavigation(productApi).navigate(input);return openPanel(PRODUCT_PANELS[input.section])}
  const conversationAddon=props=><ConversationTools {...props} productApi={productApi} onOpenSession={client.openSession} onOpenIndependentChat={botId=>openIndependentChat(productApi,openPanel,botId)} onNavigate={navigate} onOpenTools={()=>{requestWorkbenchView('tools');return openPanel('model-router-galgame')}}/>
  return new Proxy(slots,{get(target,key){
    if(key==='register')return(options,component)=>{
      if(options.name==='conversation.session.header'&&typeof options.inject==='function'){
        const original=options.inject
        return target.register({...options,inject:(...args)=>{const face=original(...args)??{};return {...face,actions:{...face.actions,conversationAddon}}}},component)
      }
      // The composer draft rides the Host's own composer slot, beside the
      // vendor's "+" extra: one wrapper keeps the registered component and its
      // props untouched, and the draft asks the Host for its namespace through
      // the product API this factory already carries.
      if(options.name==='conversation.input.left'){
        return target.register(options,withComposerDraft(component,{productApi,sessionBindingOf:client.sessionBindingOf}))
      }
      if(component!==TeamSidebar)return target.register(options,component)
      const Sidebar=props=>{
        // Read the native session/roster sources; this address only selects the
        // settings destination. Host actions still enforce the saved grants.
        const useSessions=props.useSessions??emptySource,useRoster=props.useRoster??emptySource
        const sessionId=useSessions(list=>Object.values(list.byId??{}).find(row=>(row?.retainedBy?.mainView??0)>0)?.id??null)
        const botId=useRoster(roster=>roster.threadsById?.[sessionId]?.botId??roster.byId?.[sessionId]?.id??null)
        const focusedBot=useRef(null);focusedBot.current=botId
        const sidebarAddon=useMemo(()=>function Footer({wide}){
          const go=id=>{props.actions?.setLeftDrawer?.(false);return openPanel(id)}
          return <>
            <WorkspaceShortcuts compact={!wide} onNavigate={section => {workspaceNavigation(productApi).navigate({section,botId:focusedBot.current});return go(PRODUCT_PANELS[section])}}/>
            <ContactAttentionNavigation productApi={productApi} compact={!wide}
              onNavigate={input=>{workspaceNavigation(productApi).navigate(input);return go(PRODUCT_PANELS[input.section])}}
              onOpenAdvanced={()=>go('model-router-galgame')}/>
            <WebPanelPinsLive productApi={productApi} onSelect={panelId=>navigate({section:'webPanel',panelId})}/>
          </>
        },[props.actions])
        return <TeamSidebar {...props} actions={{...props.actions,sidebarAddon}}/>
      }
      Sidebar.dsBotTeamSidebar=TeamSidebar
      return target.register(options,Sidebar)
    }
    const value=Reflect.get(target,key,target)
    return typeof value==='function'?value.bind(target):value
  }})
}
