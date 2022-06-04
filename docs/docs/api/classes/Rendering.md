---
id: "Rendering"
title: "Class: Rendering"
sidebar_label: "Rendering"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### params

• **params**: [`RenderingParams`](../modules.md#renderingparams-66)

___

### scene

• **scene**: `Scene`

___

### renderer

• **renderer**: `WebGLRenderer`

___

### composer

• **composer**: `EffectComposer`

___

### client

• **client**: [`Client`](Client.md)

## Constructors

### constructor

• **new Rendering**(`client`, `params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |
| `params` | `Partial`<[`RenderingParams`](../modules.md#renderingparams-66)\> |

## Methods

### adjustRenderer

▸ **adjustRenderer**(): `void`

#### Returns

`void`

___

### render

▸ **render**(): `void`

#### Returns

`void`

## Accessors

### renderSize

• `get` **renderSize**(): `Object`

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `width` | `number` |
| `height` | `number` |

___

### aspectRatio

• `get` **aspectRatio**(): `number`

#### Returns

`number`