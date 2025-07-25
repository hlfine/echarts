/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*/


import * as zrUtil from 'zrender/src/core/util';
import createSeriesDataSimply from '../helper/createSeriesDataSimply';
import SeriesModel from '../../model/Series';
import geoSourceManager from '../../coord/geo/geoSourceManager';
import {makeSeriesEncodeForNameBased} from '../../data/helper/sourceHelper';
import {
    SeriesOption,
    BoxLayoutOptionMixin,
    SeriesEncodeOptionMixin,
    OptionDataItemObject,
    OptionDataValueNumeric,
    ParsedValue,
    SeriesOnGeoOptionMixin,
    StatesOptionMixin,
    SeriesLabelOption,
    StatesMixinBase,
    CallbackDataParams
} from '../../util/types';
import { Dictionary } from 'zrender/src/core/types';
import GeoModel, { GeoCommonOptionMixin, GeoItemStyleOption } from '../../coord/geo/GeoModel';
import SeriesData from '../../data/SeriesData';
import Model from '../../model/Model';
import Geo from '../../coord/geo/Geo';
import { createTooltipMarkup } from '../../component/tooltip/tooltipMarkup';
import {createSymbol, ECSymbol} from '../../util/symbol';
import {LegendIconParams} from '../../component/legend/LegendModel';
import {Group} from '../../util/graphic';
import { CoordinateSystemUsageKind, decideCoordSysUsageKind } from '../../core/CoordinateSystem';
import { GeoJSONRegion } from '../../coord/geo/Region';
import tokens from '../../visual/tokens';

export interface MapStateOption<TCbParams = never> {
    itemStyle?: GeoItemStyleOption<TCbParams>
    label?: SeriesLabelOption
}
export interface MapDataItemOption extends MapStateOption,
    StatesOptionMixin<MapStateOption, StatesMixinBase>,
    OptionDataItemObject<OptionDataValueNumeric> {
    cursor?: string
    silent?: boolean
}

export type MapValueCalculationType = 'sum' | 'average' | 'min' | 'max';

export interface MapSeriesOption extends
    SeriesOption<MapStateOption<CallbackDataParams>, StatesMixinBase>,
    MapStateOption<CallbackDataParams>,
    GeoCommonOptionMixin,
    // If `geoIndex` is not specified, a exclusive geo will be
    // created. Otherwise use the specified geo component, and
    // `map` and `mapType` are ignored.
    SeriesOnGeoOptionMixin,
    BoxLayoutOptionMixin,
    SeriesEncodeOptionMixin {
    type?: 'map'

    coordinateSystem?: string;
    silent?: boolean;

    // FIXME:TS add marker types
    markLine?: any;
    markPoint?: any;
    markArea?: any;

    mapValueCalculation?: MapValueCalculationType;

    showLegendSymbol?: boolean;

    // @deprecated. Only for echarts2 backward compat.
    geoCoord?: Dictionary<number[]>;

    data?: (OptionDataValueNumeric | OptionDataValueNumeric[] | MapDataItemOption)[]


    nameProperty?: string;
}

class MapSeries extends SeriesModel<MapSeriesOption> {

    static type = 'series.map' as const;
    type = MapSeries.type;

    static dependencies = ['geo'];

    static layoutMode = 'box' as const;

    coordinateSystem: Geo;

    // -----------------
    // Injected outside
    originalData: SeriesData;
    mainSeries: MapSeries;
    // Only first map series of same mapType will drawMap.
    needsDrawMap: boolean = false;
    // Group of all map series with same mapType
    seriesGroup: MapSeries[] = [];


    getInitialData(this: MapSeries, option: MapSeriesOption): SeriesData {
        const data = createSeriesDataSimply(this, {
            coordDimensions: ['value'],
            encodeDefaulter: zrUtil.curry(makeSeriesEncodeForNameBased, this)
        });
        const dataNameIndexMap = zrUtil.createHashMap<number>();
        const toAppendItems: MapDataItemOption[] = [];

        for (let i = 0, len = data.count(); i < len; i++) {
            const name = data.getName(i);
            dataNameIndexMap.set(name, i);
        }

        const geoSource = geoSourceManager.load(this.getMapType(), this.option.nameMap, this.option.nameProperty);
        zrUtil.each(geoSource.regions, function (region) {
            const name = region.name;
            const dataNameIdx = dataNameIndexMap.get(name);
            // apply specified echarts style in GeoJSON data
            const specifiedGeoJSONRegionStyle = (region as GeoJSONRegion).properties
                && (region as GeoJSONRegion).properties.echartsStyle;
            let dataItem: MapDataItemOption;
            if (dataNameIdx == null) {
                dataItem = { name: name };
                toAppendItems.push(dataItem);
            }
            else {
                dataItem = data.getRawDataItem(dataNameIdx) as MapDataItemOption;
            }
            specifiedGeoJSONRegionStyle && zrUtil.merge(dataItem, specifiedGeoJSONRegionStyle);
        });

        // Complete data with missing regions. The consequent processes (like visual
        // map and render) can not be performed without a "full data". For example,
        // find `dataIndex` by name.
        data.appendData(toAppendItems);

        return data;
    }

    /**
     * If no host geo model, return null, which means using a
     * inner exclusive geo model.
     */
    getHostGeoModel(): GeoModel {
        if (decideCoordSysUsageKind(this).kind === CoordinateSystemUsageKind.boxCoordSys) {
            // Always use an internal geo if specify a boxCoordSys.
            // Notice that currently we do not support laying out a geo based on
            // another geo, but preserve the possibility.
            return;
        }
        return this.getReferringComponents(
            'geo', {useDefault: false, enableAll: false, enableNone: false}
        ).models[0] as GeoModel;
    }

    getMapType(): string {
        return (this.getHostGeoModel() || this).option.map;
    }

    // _fillOption(option, mapName) {
        // Shallow clone
        // option = zrUtil.extend({}, option);

        // option.data = geoCreator.getFilledRegions(option.data, mapName, option.nameMap);

        // return option;
    // }

    getRawValue(dataIndex: number): ParsedValue {
        // Use value stored in data instead because it is calculated from multiple series
        // FIXME Provide all value of multiple series ?
        const data = this.getData();
        return data.get(data.mapDimension('value'), dataIndex);
    }

    /**
     * Get model of region
     */
    getRegionModel(regionName: string): Model<MapDataItemOption> {
        const data = this.getData();
        return data.getItemModel(data.indexOfName(regionName));
    }

    /**
     * Map tooltip formatter
     */
    formatTooltip(
        dataIndex: number,
        multipleSeries: boolean,
        dataType: string
    ) {
        // FIXME orignalData and data is a bit confusing
        const data = this.getData();
        const value = this.getRawValue(dataIndex);
        const name = data.getName(dataIndex);

        const seriesGroup = this.seriesGroup;
        const seriesNames = [];
        for (let i = 0; i < seriesGroup.length; i++) {
            const otherIndex = seriesGroup[i].originalData.indexOfName(name);
            const valueDim = data.mapDimension('value');
            if (!isNaN(seriesGroup[i].originalData.get(valueDim, otherIndex) as number)) {
                seriesNames.push(seriesGroup[i].name);
            }
        }

        return createTooltipMarkup('section', {
            header: seriesNames.join(', '),
            noHeader: !seriesNames.length,
            blocks: [createTooltipMarkup('nameValue', {
                name: name, value: value
            })]
        });
    }

    getTooltipPosition = function (this: MapSeries, dataIndex: number): number[] {
        if (dataIndex != null) {
            const name = this.getData().getName(dataIndex);
            const geo = this.coordinateSystem;
            const region = geo.getRegion(name);

            return region && geo.dataToPoint(region.getCenter());
        }
    };

    setZoom(zoom: number): void {
        this.option.zoom = zoom;
    }

    setCenter(center: number[]): void {
        this.option.center = center;
    }

    getLegendIcon(opt: LegendIconParams): ECSymbol | Group {
        const iconType = opt.icon || 'roundRect';
        const icon = createSymbol(
            iconType,
            0,
            0,
            opt.itemWidth,
            opt.itemHeight,
            opt.itemStyle.fill
        );

        icon.setStyle(opt.itemStyle);
        // Map do not use itemStyle.borderWidth as border width
        icon.style.stroke = 'none';
        // No rotation because no series visual symbol for map

        if (iconType.indexOf('empty') > -1) {
            icon.style.stroke = icon.style.fill;
            icon.style.fill = tokens.color.neutral00;
            icon.style.lineWidth = 2;
        }
        return icon;
    }

    static defaultOption: MapSeriesOption = {
        // 一级层叠
        // zlevel: 0,
        // 二级层叠
        z: 2,

        coordinateSystem: 'geo',

        // map should be explicitly specified since ec3.
        map: '',

        // If `geoIndex` is not specified, a exclusive geo will be
        // created. Otherwise use the specified geo component, and
        // `map` and `mapType` are ignored.
        // geoIndex: 0,

        // 'center' | 'left' | 'right' | 'x%' | {number}
        left: 'center',
        // 'center' | 'top' | 'bottom' | 'x%' | {number}
        top: 'center',
        // right
        // bottom
        // width:
        // height

        // Aspect is width / height. Inited to be geoJson bbox aspect
        // This parameter is used for scale this aspect
        // Default value:
        // for geoSVG source: 1,
        // for geoJSON source: 0.75.
        aspectScale: null,

        // Layout with center and size
        // If you want to put map in a fixed size box with right aspect ratio
        // This two properties may be more convenient.
        // layoutCenter: [50%, 50%]
        // layoutSize: 100

        showLegendSymbol: true,

        // Define left-top, right-bottom coords to control view
        // For example, [ [180, 90], [-180, -90] ],
        // higher priority than center and zoom
        boundingCoords: null,

        // Default on center of map
        center: null,

        zoom: 1,

        scaleLimit: null,

        selectedMode: true,

        label: {
            show: false,
            color: tokens.color.tertiary
        },
        // scaleLimit: null,
        itemStyle: {
            borderWidth: 0.5,
            borderColor: tokens.color.border,
            areaColor: tokens.color.background
        },

        emphasis: {
            label: {
                show: true,
                color: tokens.color.primary
            },
            itemStyle: {
                areaColor: tokens.color.highlight
            }
        },

        select: {
            label: {
                show: true,
                color: tokens.color.primary
            },
            itemStyle: {
                color: tokens.color.highlight
            }
        },

        nameProperty: 'name'
    };

}

export default MapSeries;
