import React, { useState, useCallback, useRef } from 'react';
import { 
  ReactFlow, 
  MiniMap, 
  Controls, 
  Background, 
  useNodesState, 
  useEdgesState, 
  addEdge,
  Handle, 
  Position,
  ReactFlowProvider
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const EventNode = ({ data }) => (
  <div className="bg-blue-900 border-2 border-blue-600 rounded text-white min-w-[150px] shadow-lg">
    <div className="font-bold text-[10px] px-2 py-1 uppercase bg-blue-800 text-blue-200 rounded-t border-b border-blue-600">Event</div>
    <div className="text-sm p-2">{data.label}</div>
    <Handle type="source" position={Position.Right} className="!w-6 !h-6 md:!w-3 md:!h-3 bg-blue-400" />
  </div>
);

const ActionNode = ({ data }) => (
  <div className="bg-red-900 border-2 border-red-600 rounded text-white min-w-[150px] shadow-lg">
    <Handle type="target" position={Position.Left} className="!w-6 !h-6 md:!w-3 md:!h-3 bg-red-400" />
    <div className="font-bold text-[10px] px-2 py-1 uppercase bg-red-800 text-red-200 rounded-t border-b border-red-600">Action</div>
    <div className="text-sm p-2">{data.label}</div>
    <Handle type="source" position={Position.Right} className="!w-6 !h-6 md:!w-3 md:!h-3 bg-red-400" />
  </div>
);

const ConditionNode = ({ data }) => (
  <div className="bg-yellow-900 border-2 border-yellow-600 rounded text-white min-w-[150px] shadow-lg">
    <Handle type="target" position={Position.Left} className="!w-6 !h-6 md:!w-3 md:!h-3 bg-yellow-400" />
    <div className="font-bold text-[10px] px-2 py-1 uppercase bg-yellow-800 text-yellow-200 rounded-t border-b border-yellow-600">Condition</div>
    <div className="text-sm p-2">{data.label}</div>
    <Handle type="source" position={Position.Right} id="true" className="!w-6 !h-6 md:!w-3 md:!h-3 bg-green-400 top-1/3" />
    <div className="absolute right-[-25px] top-[22px] text-[10px] text-green-400 font-bold">True</div>
    <Handle type="source" position={Position.Right} id="false" className="!w-6 !h-6 md:!w-3 md:!h-3 bg-red-400 top-2/3" />
    <div className="absolute right-[-28px] top-[48px] text-[10px] text-red-400 font-bold">False</div>
  </div>
);

const MathNode = ({ data }) => (
  <div className="bg-purple-900 border-2 border-purple-600 rounded text-white min-w-[150px] shadow-lg">
    <Handle type="target" position={Position.Left} className="!w-6 !h-6 md:!w-3 md:!h-3 bg-purple-400" />
    <div className="font-bold text-[10px] px-2 py-1 uppercase bg-purple-800 text-purple-200 rounded-t border-b border-purple-600">Math</div>
    <div className="text-sm p-2">{data.label}</div>
    <Handle type="source" position={Position.Right} className="!w-6 !h-6 md:!w-3 md:!h-3 bg-purple-400" />
  </div>
);

const PhysicsNode = ({ data }) => (
  <div className="bg-orange-900 border-2 border-orange-600 rounded text-white min-w-[150px] shadow-lg">
    <Handle type="target" position={Position.Left} className="!w-6 !h-6 md:!w-3 md:!h-3 bg-orange-400" />
    <div className="font-bold text-[10px] px-2 py-1 uppercase bg-orange-800 text-orange-200 rounded-t border-b border-orange-600">Physics</div>
    <div className="text-sm p-2">{data.label}</div>
    <Handle type="source" position={Position.Right} className="!w-6 !h-6 md:!w-3 md:!h-3 bg-orange-400" />
  </div>
);

const nodeTypes = {
  event: EventNode,
  action: ActionNode,
  condition: ConditionNode,
  math: MathNode,
  physics: PhysicsNode
};

const initialNodes = [
  { id: '1', type: 'event', position: { x: 50, y: 100 }, data: { label: 'On Update' } },
  { id: '2', type: 'condition', position: { x: 300, y: 85 }, data: { label: 'Distance < 10' } },
  { id: '3', type: 'action', position: { x: 550, y: 50 }, data: { label: 'Attack' } },
  { id: '4', type: 'action', position: { x: 550, y: 150 }, data: { label: 'Move Towards Player' } },
  { id: '5', type: 'event', position: { x: 50, y: 300 }, data: { label: 'On Collision Enter' } },
  { id: '6', type: 'physics', position: { x: 300, y: 300 }, data: { label: 'Apply Damage (10)' } },
  { id: '7', type: 'action', position: { x: 550, y: 300 }, data: { label: 'Play Hit Sound' } },
];

const initialEdges = [
  { id: 'e1-2', source: '1', target: '2' },
  { id: 'e2-3', source: '2', target: '3', sourceHandle: 'true', animated: true, style: { stroke: '#4ade80' } },
  { id: 'e2-4', source: '2', target: '4', sourceHandle: 'false', animated: true, style: { stroke: '#f87171' } },
  { id: 'e5-6', source: '5', target: '6' },
  { id: 'e6-7', source: '6', target: '7' },
];

function Sidebar({ onDragStart }) {
  const nodeCategories = [
    { title: 'Events', type: 'event', items: ['On Start', 'On Update', 'On Collision Enter', 'On Pointer Down'] },
    { title: 'Actions', type: 'action', items: ['Move Towards Player', 'Attack', 'Play Hit Sound', 'Play Animation', 'Destroy Entity', 'Spawn Particle'] },
    { title: 'Conditions', type: 'condition', items: ['Distance < 10', 'Health > 0', 'Is Grounded', 'Has Line of Sight'] },
    { title: 'Math', type: 'math', items: ['Add', 'Subtract', 'Multiply', 'Random Float', 'Vector Distance'] },
    { title: 'Physics', type: 'physics', items: ['Apply Force', 'Set Velocity', 'Apply Damage (10)', 'Raycast'] },
  ];

  return (
    <div className="w-64 bg-[#0a0a0a] border-r border-[#222] flex flex-col z-30 shrink-0 h-full text-white">
      <div className="p-3 border-b border-neutral-800 font-bold text-sm tracking-wider uppercase text-neutral-400 bg-neutral-900/30">
        Node Library
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-6">
        {nodeCategories.map((cat, idx) => (
          <div key={idx}>
            <div className="text-xs font-semibold text-neutral-500 mb-2 uppercase">{cat.title}</div>
            <div className="space-y-2">
              {cat.items.map((item, i) => (
                <div
                  key={i}
                  className="bg-neutral-800 border border-neutral-700 p-3 md:p-2 rounded text-sm md:text-xs cursor-grab hover:bg-neutral-700 transition-colors"
                  onDragStart={(event) => onDragStart(event, cat.type, item)}
                  draggable
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function generateCode(nodes, edges) {
    const events = nodes.filter(n => n.type === 'event');
    let code = `// =============================================\n`;
    code += `// Auto-Generated Logic from Visual Graph\n`;
    code += `// =============================================\n\n`;
    
    code += `export class CustomBehavior extends Component {\n`;
    
    events.forEach(evt => {
        let eventName = evt.data.label;
        let methodName = '';
        if (eventName === 'On Start') methodName = 'onStart()';
        else if (eventName === 'On Update') methodName = 'update(dt)';
        else if (eventName === 'On Collision Enter') methodName = 'onCollisionEnter(other)';
        else if (eventName === 'On Pointer Down') methodName = 'onPointerDown(e)';
        else methodName = eventName.toLowerCase().replace(/\s+/g, '') + '()';
        
        code += `    ${methodName} {\n`;
        
        function traverse(nodeId, indent, sourceHandle = null) {
            const outgoingEdges = edges.filter(e => e.source === nodeId && (sourceHandle === null || e.sourceHandle === sourceHandle));
            
            outgoingEdges.forEach(edge => {
                const targetNode = nodes.find(n => n.id === edge.target);
                if (targetNode) {
                    code += `${indent}// [Node: ${targetNode.type}] ${targetNode.data.label}\n`;
                    
                    if (targetNode.type === 'action' || targetNode.type === 'physics' || targetNode.type === 'math') {
                        // Generate mock code based on label
                        const label = targetNode.data.label;
                        if (label.includes('Move Towards')) code += `${indent}this.moveToTarget(this.player, dt);\n`;
                        else if (label === 'Attack') code += `${indent}this.performAttack();\n`;
                        else if (label === 'Play Hit Sound') code += `${indent}if (this.engine.audio) this.engine.audio.playSound('hit');\n`;
                        else if (label.includes('Apply Damage')) code += `${indent}other.getComponent('Health')?.damage(10);\n`;
                        else code += `${indent}this.execute('${label}');\n`;
                        
                        // continue traversing
                        traverse(targetNode.id, indent);
                        
                    } else if (targetNode.type === 'condition') {
                        let condStr = 'true';
                        if (targetNode.data.label === 'Distance < 10') condStr = 'this.distanceToPlayer() < 10';
                        else if (targetNode.data.label === 'Health > 0') condStr = 'this.health > 0';
                        else if (targetNode.data.label === 'Is Grounded') condStr = 'this.isGrounded';
                        
                        code += `${indent}if (${condStr}) {\n`;
                        traverse(targetNode.id, indent + '    ', 'true');
                        code += `${indent}} else {\n`;
                        traverse(targetNode.id, indent + '    ', 'false');
                        code += `${indent}}\n`;
                    }
                }
            });
        }
        
        traverse(evt.id, '        ');
        code += `    }\n\n`;
    });
    
    code += `}\n`;
    return code;
}

export function LogicGraph() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const reactFlowWrapper = useRef(null);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  
  const [compiledCode, setCompiledCode] = useState(null);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );

  const onDragStart = (event, nodeType, label) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify({ type: nodeType, label }));
    event.dataTransfer.effectAllowed = 'move';
  };

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();

      if (!reactFlowInstance) return;

      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
      const typeData = event.dataTransfer.getData('application/reactflow');
      
      if (!typeData) return;
      const { type, label } = JSON.parse(typeData);

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      const newNode = {
        id: `dndnode_${Date.now()}`,
        type,
        position,
        data: { label: label },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);
  
  const handleCompile = () => {
      const code = generateCode(nodes, edges);
      setCompiledCode(code);
  };

  return (
    <ReactFlowProvider>
        <div className="w-full h-full bg-[#111] flex relative">
            <Sidebar onDragStart={onDragStart} />
            
            <div className="flex-1 flex flex-col relative">
                {/* Toolbar */}
                <div className="h-14 md:h-10 border-b border-neutral-800 bg-[#1a1a1a] flex items-center px-4 justify-between shrink-0">
                    <div className="flex gap-2 text-xs font-bold uppercase tracking-wider text-neutral-400">
                        <span>Logic Graph Editor</span>
                    </div>
                    <div className="flex gap-2">
                        <button 
                            onClick={handleCompile}
                            className="px-4 py-3 md:py-1.5 bg-green-900/40 text-green-400 rounded hover:bg-green-900/60 text-xs font-bold transition-colors border border-green-900"
                        >
                            Compile to Code
                        </button>
                    </div>
                </div>
                
                {/* Graph Area */}
                <div className="flex-1 w-full h-full relative" ref={reactFlowWrapper}>
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onInit={setReactFlowInstance}
                        onDrop={onDrop}
                        onDragOver={onDragOver}
                        nodeTypes={nodeTypes}
                        fitView
                        className="bg-neutral-900"
                    >
                        <Controls className="bg-neutral-800 border-neutral-700 fill-white" />
                        <MiniMap className="bg-neutral-800" maskColor="rgba(0,0,0,0.5)" nodeColor="#444" />
                        <Background variant="dots" gap={24} size={1} color="#444" />
                    </ReactFlow>
                </div>
                
                {/* Compiled Code Overlay */}
                {compiledCode && (
                    <div className="absolute right-4 bottom-4 w-[450px] max-h-[500px] bg-[#1a1a1a] border border-neutral-700 rounded-lg shadow-2xl flex flex-col z-50">
                        <div className="p-3 border-b border-neutral-700 flex justify-between items-center bg-neutral-800 rounded-t-lg">
                            <h3 className="text-sm font-bold text-white">Generated Code (FSM/StateMachine)</h3>
                            <button onClick={() => setCompiledCode(null)} className="text-neutral-400 hover:text-white">✕</button>
                        </div>
                        <div className="p-3 overflow-y-auto flex-1 bg-black rounded-b-lg">
                            <pre className="text-green-400 text-xs font-mono whitespace-pre-wrap">
                                {compiledCode}
                            </pre>
                        </div>
                    </div>
                )}
            </div>
        </div>
    </ReactFlowProvider>
  );
}
