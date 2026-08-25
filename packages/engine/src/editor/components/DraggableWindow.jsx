import React, { useState, useEffect, useRef } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';

export function DraggableWindow({ title, children, onClose, initialWidth = 800, initialHeight = 600, defaultX = 100, defaultY = 50 }) {
    const [pos, setPos] = useState({ x: defaultX, y: defaultY });
    const [size, setSize] = useState({ w: initialWidth, h: initialHeight });
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [isMaximized, setIsMaximized] = useState(false);
    const dragStart = useRef({ x: 0, y: 0, posStartX: 0, posStartY: 0 });
    const resizeStart = useRef({ x: 0, y: 0, wStart: 0, hStart: 0 });

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (isDragging) {
                setPos({
                    x: dragStart.current.posStartX + (e.clientX - dragStart.current.x),
                    y: dragStart.current.posStartY + (e.clientY - dragStart.current.y)
                });
            } else if (isResizing) {
                setSize({
                    w: Math.max(300, resizeStart.current.wStart + (e.clientX - resizeStart.current.x)),
                    h: Math.max(200, resizeStart.current.hStart + (e.clientY - resizeStart.current.y))
                });
            }
        };
        const handleMouseUp = () => {
            setIsDragging(false);
            setIsResizing(false);
        };
        if (isDragging || isResizing) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, isResizing]);

    return (
        <div 
            className="fixed z-50 flex flex-col bg-neutral-950 border border-neutral-700 shadow-2xl rounded overflow-hidden"
            style={isMaximized ? {
                top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%'
            } : {
                left: pos.x, top: pos.y, width: size.w, height: size.h
            }}
        >
            <div 
                className="flex items-center justify-between px-3 py-2 bg-neutral-900 border-b border-neutral-800 cursor-move select-none"
                onMouseDown={(e) => {
                    if (e.target.closest('button')) return;
                    setIsDragging(true);
                    dragStart.current = { x: e.clientX, y: e.clientY, posStartX: pos.x, posStartY: pos.y };
                }}
            >
                <div className="font-bold text-sm text-neutral-300">{title}</div>
                <div className="flex items-center gap-2">
                    <button onClick={() => setIsMaximized(!isMaximized)} className="text-neutral-400 hover:text-white p-1">
                        {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    </button>
                    <button onClick={onClose} className="text-neutral-400 hover:text-red-400 p-1">
                        <X size={16} />
                    </button>
                </div>
            </div>
            
            <div className="flex-1 relative flex flex-col min-h-0 bg-black">
                {/* Pointer events none while dragging so iframe doesn't steal events */}
                <div className={`w-full h-full flex flex-col ${isDragging || isResizing ? 'pointer-events-none' : ''}`}>
                    {children}
                </div>
            </div>

            {!isMaximized && (
                <div 
                    className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
                    onMouseDown={(e) => {
                        setIsResizing(true);
                        resizeStart.current = { x: e.clientX, y: e.clientY, wStart: size.w, hStart: size.h };
                    }}
                />
            )}
        </div>
    );
}
