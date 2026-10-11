import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ReactNode} from 'react';
import {MediaButton} from '../vendor/peerix-picker/media-button';
const hooks=vi.hoisted(()=>({load:vi.fn(async():Promise<void>=>undefined)}));
vi.mock('../vendor/peerix-picker/use-media-devices',()=>({useMediaDevices:()=>[[{deviceId:'first',label:'First device'},{deviceId:'second',label:'Second device'}],hooks.load]}));
vi.mock('../vendor/peerix-picker/use-audio-analysis',()=>({useAudioLevels:()=>[0,0]}));
// Test the picker lifecycle independently of Radix's portal and focus implementation.
vi.mock('@/components/ui/dropdown-menu',async()=>{
 const React=await import('react');
 const Context=React.createContext({open:false,onOpenChange:(_value:boolean)=>{void _value;}});
 const Radio=React.createContext({onValueChange:(_value:string)=>{void _value;}});
 return {
  DropdownMenu:({open,onOpenChange,children}:{open:boolean;onOpenChange:(value:boolean)=>void;children:ReactNode})=><Context.Provider value={{open,onOpenChange}}>{children}</Context.Provider>,
  DropdownMenuTrigger:({children}:{children:ReactNode})=>{const context=React.useContext(Context);return <div onClick={()=>context.onOpenChange(!context.open)}>{children}</div>;},
  DropdownMenuContent:({children}:{children:ReactNode})=>{const context=React.useContext(Context);return context.open?<div><button onClick={()=>context.onOpenChange(false)}>Close preview</button>{children}</div>:null;},
  DropdownMenuGroup:({children}:{children:ReactNode})=><div>{children}</div>,DropdownMenuSeparator:()=>null,
  DropdownMenuRadioGroup:({children,onValueChange,value}:{children:ReactNode;onValueChange:(value:string)=>void;value:string})=><Radio.Provider value={{onValueChange}}><div data-testid="device-choice" data-selected={value}>{children}</div></Radio.Provider>,
  DropdownMenuRadioItem:({children,value,disabled}:{children:ReactNode;value:string;disabled?:boolean})=>{const context=React.useContext(Radio);return <button disabled={disabled} onClick={()=>context.onValueChange(value)}>{children}</button>;},
 };
});
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};};
const input=()=>{const stop=vi.fn();return {value:{getTracks:()=>[{stop}]} as unknown as MediaStream,stop};};
let frames:Map<number,FrameRequestCallback>;let frameIndex:number;let getUserMedia:ReturnType<typeof vi.fn>;
async function flushFrames(){await act(async()=>{await Promise.resolve();});await act(async()=>{const pending=[...frames.values()];frames.clear();for(const frame of pending)frame(0);await Promise.resolve();});}
const open=()=>fireEvent.click(screen.getByLabelText('Microphone devices'));
beforeEach(()=>{hooks.load.mockReset().mockResolvedValue(undefined);frames=new Map();frameIndex=0;getUserMedia=vi.fn();vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{frames.set(++frameIndex,fn);return frameIndex;});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia},configurable:true});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('device-picker canceled preview cleanup',()=>{
 it('does not request media on render',()=>{render(<MediaButton kind="audio" enabled onToggle={()=>{}}/>);expect(getUserMedia).not.toHaveBeenCalled();expect(hooks.load).not.toHaveBeenCalled();});
 it('does not request media after closing during device enumeration',async()=>{const pending=deferred<void>();hooks.load.mockReturnValueOnce(pending.promise);render(<MediaButton kind="audio" enabled onToggle={()=>{}}/>);open();fireEvent.click(screen.getByText('Close preview'));await act(async()=>pending.resolve());await flushFrames();expect(getUserMedia).not.toHaveBeenCalled();});
 it('cancels a queued animation-frame preview on close',async()=>{render(<MediaButton kind="audio" enabled onToggle={()=>{}}/>);open();await act(async()=>{await Promise.resolve();});expect(frames.size).toBe(1);fireEvent.click(screen.getByText('Close preview'));await flushFrames();expect(getUserMedia).not.toHaveBeenCalled();});
 it('stops a stream granted after preview dismissal',async()=>{const pending=deferred<MediaStream>();getUserMedia.mockReturnValueOnce(pending.promise);render(<MediaButton kind="audio" enabled onToggle={()=>{}}/>);open();await flushFrames();expect(getUserMedia).toHaveBeenCalledOnce();fireEvent.click(screen.getByText('Close preview'));const late=input();await act(async()=>pending.resolve(late.value));expect(late.stop).toHaveBeenCalledOnce();});
 it('stops a late stream after unmount',async()=>{const pending=deferred<MediaStream>();getUserMedia.mockReturnValueOnce(pending.promise);const view=render(<MediaButton kind="audio" enabled onToggle={()=>{}}/>);open();await flushFrames();view.unmount();const late=input();await act(async()=>pending.resolve(late.value));expect(late.stop).toHaveBeenCalledOnce();});
 it('closes and releases active preview when disabled changes',async()=>{const active=input();getUserMedia.mockResolvedValueOnce(active.value);const view=render(<MediaButton kind="audio" enabled onToggle={()=>{}}/>);open();await flushFrames();view.rerender(<MediaButton kind="audio" enabled disabled onToggle={()=>{}}/>);expect(active.stop).toHaveBeenCalledOnce();expect(screen.queryByText('Close preview')).toBeNull();});
 it('stops a late permission grant after becoming disabled',async()=>{const pending=deferred<MediaStream>();getUserMedia.mockReturnValueOnce(pending.promise);const view=render(<MediaButton kind="audio" enabled onToggle={()=>{}}/>);open();await flushFrames();view.rerender(<MediaButton kind="audio" enabled disabled onToggle={()=>{}}/>);const late=input();await act(async()=>pending.resolve(late.value));expect(late.stop).toHaveBeenCalledOnce();});
 it('keeps only the newest selected-device stream and never reports a stale choice',async()=>{const initial=input();const old=deferred<MediaStream>();const recent=deferred<MediaStream>();getUserMedia.mockResolvedValueOnce(initial.value).mockReturnValueOnce(old.promise).mockReturnValueOnce(recent.promise);const changed=vi.fn();render(<MediaButton kind="audio" enabled onToggle={()=>{}} onDeviceChange={changed}/>);open();await flushFrames();fireEvent.click(screen.getByText('First device'));fireEvent.click(screen.getByText('Second device'));const newer=input();await act(async()=>recent.resolve(newer.value));const older=input();await act(async()=>old.resolve(older.value));expect(initial.stop).toHaveBeenCalledOnce();expect(older.stop).toHaveBeenCalledOnce();expect(newer.stop).not.toHaveBeenCalled();expect(changed).toHaveBeenCalledExactlyOnceWith('second');fireEvent.click(screen.getByText('Close preview'));expect(newer.stop).toHaveBeenCalledOnce();});
 it('reports unavailable permission and does not call the device callback',async()=>{getUserMedia.mockRejectedValueOnce(new Error('denied'));const changed=vi.fn();render(<MediaButton kind="audio" enabled onToggle={()=>{}} onDeviceChange={changed}/>);open();await flushFrames();expect(screen.getByRole('status').textContent).toContain('unavailable');expect(changed).not.toHaveBeenCalled();});
 it('keeps audio preview requests camera-free',async()=>{const active=input();getUserMedia.mockResolvedValueOnce(active.value);render(<MediaButton kind="audio" enabled onToggle={()=>{}}/>);open();await flushFrames();expect(getUserMedia).toHaveBeenCalledWith({audio:{deviceId:{exact:'first'}},video:false});});
 it('awaits actual session device selection before updating the selected value',async()=>{
  const initial=input();const next=input();getUserMedia.mockResolvedValueOnce(initial.value).mockResolvedValueOnce(next.value);const applied=deferred<void>();const changed=vi.fn(()=>applied.promise);
  render(<MediaButton kind="audio" enabled onToggle={()=>{}} onDeviceChange={changed}/>);open();await flushFrames();fireEvent.click(screen.getByText('Second device'));await act(async()=>{await Promise.resolve();});
  expect(changed).toHaveBeenCalledWith('second');expect(screen.getByTestId('device-choice').dataset.selected).toBe('first');await act(async()=>applied.resolve());expect(screen.getByTestId('device-choice').dataset.selected).toBe('second');
 });
 it('preserves the previous choice and stops preview if actual session selection rejects',async()=>{
  const initial=input();const next=input();getUserMedia.mockResolvedValueOnce(initial.value).mockResolvedValueOnce(next.value);const changed=vi.fn(async()=>{throw new Error('actual swap failed');});
  render(<MediaButton kind="audio" enabled onToggle={()=>{}} onDeviceChange={changed}/>);open();await flushFrames();fireEvent.click(screen.getByText('Second device'));await act(async()=>{await Promise.resolve();});
  expect(screen.getByTestId('device-choice').dataset.selected).toBe('first');expect(screen.getByRole('status').textContent).toContain('previous choice');expect(next.stop).toHaveBeenCalledOnce();
 });
 it('does not restore preview selection after closing during an asynchronous device swap',async()=>{
  const initial=input();const next=input();getUserMedia.mockResolvedValueOnce(initial.value).mockResolvedValueOnce(next.value);const applied=deferred<void>();
  render(<MediaButton kind="audio" enabled onToggle={()=>{}} onDeviceChange={()=>applied.promise}/>);open();await flushFrames();fireEvent.click(screen.getByText('Second device'));await act(async()=>{await Promise.resolve();});fireEvent.click(screen.getByText('Close preview'));await act(async()=>applied.resolve());expect(next.stop).toHaveBeenCalledOnce();expect(screen.queryByTestId('device-choice')).toBeNull();
 });

});
