# ADR 002: Plugin API

## Status
Accepted

## Context
Foundry needs an extensible way for developers to add new features, tools, and editor panels without modifying the core engine code. This requires a robust Plugin API that can safely hook into engine lifecycles, UI rendering, and asset pipelines.

## Decision
We will implement a modular Plugin Architecture consisting of two layers:

### 1. Engine Plugins
Engine plugins can add new systems, components, and event listeners directly to the runtime.
- A plugin is a class implementing a `register(engine)` and `unregister(engine)` interface.
- Core systems (Physics, Rendering) should ideally be structured similarly to plugins, ensuring the API is powerful enough for third-party developers.

```javascript
class MyCustomPhysicsPlugin {
    register(engine) {
        engine.registerSystem(new MyPhysicsSystem());
        engine.registerComponent('RigidBody', RigidBodyComponent);
    }
    unregister(engine) {
        // Cleanup logic
    }
}
```

### 2. Editor Plugins
Editor plugins interact with the React-based IDE. They can inject custom React components into specific "Docking Zones" (e.g., Toolbar, Sidebar, Inspector).
- The `EditorManager` will expose a `registerPanel(id, config)` method.
- Plugins are loaded before the main `App` renders, allowing them to provide context and extensions.

```javascript
editorManager.registerPanel('custom-tools', {
    title: 'Level Generator',
    position: 'left-sidebar',
    render: (engine) => <LevelGeneratorUI engine={engine} />
});
```

### 3. Plugin Loading Lifecycle
1. Engine Initialization (`new Engine()`)
2. `engine.plugins.loadAll(pluginsArray)`
3. For each plugin -> `plugin.register(engine)`
4. World Start (`world.start()`)
5. Systems evaluate.

## Consequences
- **Extensibility**: Third-party developers can create tools without forking the engine.
- **Complexity**: Requires careful design to ensure Editor Plugins (React) and Engine Plugins (Vanilla JS / Web Worker) can communicate if needed.
- **Security**: Plugins have full access to the engine instance, meaning malicious plugins can execute arbitrary code. This is acceptable for a developer tool.
