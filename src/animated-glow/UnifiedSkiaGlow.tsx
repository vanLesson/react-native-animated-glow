import React, { FC, useMemo } from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { Canvas, Fill, Skia, Shader, type SkRuntimeEffect } from "@shopify/react-native-skia";
import Animated, { useDerivedValue, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import type { Layout, GlowConfig, RGBColor, GlowPlacement } from './types';
import {
    interpolateNumber,
    interpolateNumberArray,
    getGlowSizeVec4Worklet,
    interpolateColorArrayWorklet,
    getGradientColorWorklet,
    parseColorToRgbaWorklet,
    interpolateRgbaWorklet,
} from './helpers';

const MAX_SKIA_LAYERS = 10;

// iOS shader - uses uniform arrays (works on iOS but not all Android devices)
const skslIOS = `
  uniform vec2 u_resolution;
  uniform vec2 u_rectSize;
  uniform float u_cornerRadius;
  uniform vec4 u_backgroundColor;
  
  uniform float u_borderWidth;
  uniform float u_borderProgress;
  
  uniform int u_layerCount;
  uniform float u_coverage[${MAX_SKIA_LAYERS}];
  uniform vec4 u_glowSizes[${MAX_SKIA_LAYERS}]; 
  uniform float u_opacity[${MAX_SKIA_LAYERS}];
  uniform float u_relativeOffset[${MAX_SKIA_LAYERS}];
  uniform float u_layerProgress[${MAX_SKIA_LAYERS}];

  uniform vec4 u_colors_0[8];
  uniform vec4 u_colors_1[8];
  uniform vec4 u_colors_2[8];
  uniform vec4 u_colors_3[8];
  uniform vec4 u_colors_4[8];
  uniform vec4 u_colors_5[8];
  uniform vec4 u_colors_6[8];
  uniform vec4 u_colors_7[8];
  uniform vec4 u_colors_8[8];
  uniform vec4 u_colors_9[8];
  uniform vec4 u_colors_10[8];

  uniform float u_masterOpacity;
  uniform float u_placements[${MAX_SKIA_LAYERS}];
  uniform float u_isBorderAnimated;

  const float PI = 3.14159265359;
  float smooth(float t) { return t * t * (3.0 - 2.0 * t); }
  vec4 getGradientColor(float progress, vec4 colors[8]) { float t=progress*7.0;vec4 finalColor=colors[7];for(int i=6;i>=0;i--){if(t<float(i+1)){finalColor=mix(colors[i],colors[i+1],t-float(i));}}return finalColor; }
  float sdfRoundedBox(vec2 p, vec2 b, float r) { vec2 q=abs(p)-b+r;return min(max(q.x,q.y),0.0)+length(max(q,0.0))-r; }
  float calculatePerimeterProgress(vec2 p, vec2 b, float r) { float w=b.x-r;float h=b.y-r;float c=PI*r/2.0;float H=2.0*w;float V=2.0*h;float s0_end=c;float s1_end=s0_end+H;float s2_end=s1_end+c;float s3_end=s2_end+V;float s4_end=s3_end+c;float s5_end=s4_end+H;float s6_end=s5_end+c;float perimeter=s6_end+V;if(perimeter==0.0)return 0.0;float dist=0.0;if(p.x<-w){if(p.y<-h){vec2 corner_p=p-vec2(-w,-h);dist=c*((atan(corner_p.y,corner_p.x)+PI)/(PI/2.0));}else if(p.y>h){vec2 corner_p=p-vec2(-w,h);dist=s5_end+c*((atan(corner_p.y,corner_p.x)-PI/2.0)/(PI/2.0));}else{dist=s6_end+(h-p.y);}}else if(p.x>w){if(p.y<-h){vec2 corner_p=p-vec2(w,-h);dist=s1_end+c*((atan(corner_p.y,corner_p.x)+PI/2.0)/(PI/2.0));}else if(p.y>h){vec2 corner_p=p-vec2(w,h);dist=s3_end+c*(atan(corner_p.y,corner_p.x)/(PI/2.0));}else{dist=s2_end+(h+p.y);}}else{if(p.y<0.0){dist=s0_end+(w+p.x);}else{dist=s4_end+(w-p.x);}} return dist/perimeter; }
  float getInterpolatedSize(float progress, vec4 sizes) { float segLen=1.0/3.0;if(progress<segLen){return mix(sizes.x,sizes.y,smooth(progress/segLen));}else if(progress<2.0*segLen){return mix(sizes.y,sizes.z,smooth((progress-segLen)/segLen));}else{return mix(sizes.z,sizes.w,smooth((progress-2.0*segLen)/segLen));} }
  float gaussian(float x, float mu, float sigma) { if(sigma<=0.0)return 0.0;return exp(-(pow(x-mu,2.0))/(2.0*pow(sigma,2.0))); }
  
  vec4 main(vec2 fragCoord) {
    vec2 center = u_resolution * 0.5;
    vec2 p = fragCoord - center;
    vec2 b = u_rectSize * 0.5;
    float d = sdfRoundedBox(p, b, u_cornerRadius);
    float perimeterProgress = calculatePerimeterProgress(p, b, u_cornerRadius);
    
    vec4 behindGlow = vec4(0.0);
    vec4 frontGlow = vec4(0.0);
    
    for (int i = 0; i < ${MAX_SKIA_LAYERS}; i++) {
        if (i >= u_layerCount) break;
        float animatedProgress = fract(perimeterProgress - u_layerProgress[i] + u_relativeOffset[i]);
        if (animatedProgress > u_coverage[i] || u_coverage[i] == 0.0) continue;
        float segmentProgress = animatedProgress / u_coverage[i];
        float currentGlowSize = getInterpolatedSize(segmentProgress, u_glowSizes[i]);
        float calculatedOpacity = gaussian(abs(d), 0.0, currentGlowSize);
        if (d > 0.0 && u_placements[i] == 1.0) calculatedOpacity = 0.0;
        if (calculatedOpacity > 0.0) {
            vec4 color;
            if (i == 0) color = getGradientColor(segmentProgress, u_colors_1);
            else if (i == 1) color = getGradientColor(segmentProgress, u_colors_2);
            else if (i == 2) color = getGradientColor(segmentProgress, u_colors_3);
            else if (i == 3) color = getGradientColor(segmentProgress, u_colors_4);
            else if (i == 4) color = getGradientColor(segmentProgress, u_colors_5);
            else if (i == 5) color = getGradientColor(segmentProgress, u_colors_6);
            else if (i == 6) color = getGradientColor(segmentProgress, u_colors_7);
            else if (i == 7) color = getGradientColor(segmentProgress, u_colors_8);
            else if (i == 8) color = getGradientColor(segmentProgress, u_colors_9);
            else if (i == 9) color = getGradientColor(segmentProgress, u_colors_10);
            
            vec4 glowComponent = color * calculatedOpacity * u_opacity[i];
            if (u_placements[i] == 0.0) {
                behindGlow += glowComponent;
            } else {
                frontGlow += glowComponent;
            }
        }
    }
    
    vec4 finalColor = behindGlow;
    if (d <= 0.0) {
        finalColor = mix(finalColor, u_backgroundColor, u_backgroundColor.a);
    }
    finalColor += frontGlow;
    
    if (u_isBorderAnimated > 0.5 && u_borderWidth > 0.0) {
      float borderDist = abs(d);
      float halfWidth = u_borderWidth / 2.0;
      float borderStrength = 1.0 - smoothstep(halfWidth - 1.0, halfWidth + 1.0, borderDist);
      if (borderStrength > 0.0) {
        float borderAnimatedProgress = fract(perimeterProgress - u_borderProgress);
        vec4 borderColor = getGradientColor(borderAnimatedProgress, u_colors_0);
        finalColor = mix(finalColor, borderColor, borderStrength);
      }
    }

    return finalColor * u_masterOpacity;
  }
`;

// Android shader - all arrays unrolled for compatibility with OpenGL ES on Android
const skslAndroid = `
  uniform vec2 u_resolution;
  uniform vec2 u_rectSize;
  uniform float u_cornerRadius;
  uniform vec4 u_backgroundColor;
  
  uniform float u_borderWidth;
  uniform float u_borderProgress;
  
  uniform int u_layerCount;
  
  // Unrolled layer uniforms (10 layers)
  uniform float u_coverage_0; uniform float u_coverage_1; uniform float u_coverage_2; uniform float u_coverage_3; uniform float u_coverage_4;
  uniform float u_coverage_5; uniform float u_coverage_6; uniform float u_coverage_7; uniform float u_coverage_8; uniform float u_coverage_9;
  
  uniform vec4 u_glowSizes_0; uniform vec4 u_glowSizes_1; uniform vec4 u_glowSizes_2; uniform vec4 u_glowSizes_3; uniform vec4 u_glowSizes_4;
  uniform vec4 u_glowSizes_5; uniform vec4 u_glowSizes_6; uniform vec4 u_glowSizes_7; uniform vec4 u_glowSizes_8; uniform vec4 u_glowSizes_9;
  
  uniform float u_opacity_0; uniform float u_opacity_1; uniform float u_opacity_2; uniform float u_opacity_3; uniform float u_opacity_4;
  uniform float u_opacity_5; uniform float u_opacity_6; uniform float u_opacity_7; uniform float u_opacity_8; uniform float u_opacity_9;
  
  uniform float u_relativeOffset_0; uniform float u_relativeOffset_1; uniform float u_relativeOffset_2; uniform float u_relativeOffset_3; uniform float u_relativeOffset_4;
  uniform float u_relativeOffset_5; uniform float u_relativeOffset_6; uniform float u_relativeOffset_7; uniform float u_relativeOffset_8; uniform float u_relativeOffset_9;
  
  uniform float u_layerProgress_0; uniform float u_layerProgress_1; uniform float u_layerProgress_2; uniform float u_layerProgress_3; uniform float u_layerProgress_4;
  uniform float u_layerProgress_5; uniform float u_layerProgress_6; uniform float u_layerProgress_7; uniform float u_layerProgress_8; uniform float u_layerProgress_9;
  
  uniform float u_placements_0; uniform float u_placements_1; uniform float u_placements_2; uniform float u_placements_3; uniform float u_placements_4;
  uniform float u_placements_5; uniform float u_placements_6; uniform float u_placements_7; uniform float u_placements_8; uniform float u_placements_9;

  // Unrolled color uniforms (8 colors per layer, 11 layers including border)
  uniform vec4 u_colors_0_0; uniform vec4 u_colors_0_1; uniform vec4 u_colors_0_2; uniform vec4 u_colors_0_3;
  uniform vec4 u_colors_0_4; uniform vec4 u_colors_0_5; uniform vec4 u_colors_0_6; uniform vec4 u_colors_0_7;
  
  uniform vec4 u_colors_1_0; uniform vec4 u_colors_1_1; uniform vec4 u_colors_1_2; uniform vec4 u_colors_1_3;
  uniform vec4 u_colors_1_4; uniform vec4 u_colors_1_5; uniform vec4 u_colors_1_6; uniform vec4 u_colors_1_7;
  
  uniform vec4 u_colors_2_0; uniform vec4 u_colors_2_1; uniform vec4 u_colors_2_2; uniform vec4 u_colors_2_3;
  uniform vec4 u_colors_2_4; uniform vec4 u_colors_2_5; uniform vec4 u_colors_2_6; uniform vec4 u_colors_2_7;
  
  uniform vec4 u_colors_3_0; uniform vec4 u_colors_3_1; uniform vec4 u_colors_3_2; uniform vec4 u_colors_3_3;
  uniform vec4 u_colors_3_4; uniform vec4 u_colors_3_5; uniform vec4 u_colors_3_6; uniform vec4 u_colors_3_7;
  
  uniform vec4 u_colors_4_0; uniform vec4 u_colors_4_1; uniform vec4 u_colors_4_2; uniform vec4 u_colors_4_3;
  uniform vec4 u_colors_4_4; uniform vec4 u_colors_4_5; uniform vec4 u_colors_4_6; uniform vec4 u_colors_4_7;
  
  uniform vec4 u_colors_5_0; uniform vec4 u_colors_5_1; uniform vec4 u_colors_5_2; uniform vec4 u_colors_5_3;
  uniform vec4 u_colors_5_4; uniform vec4 u_colors_5_5; uniform vec4 u_colors_5_6; uniform vec4 u_colors_5_7;
  
  uniform vec4 u_colors_6_0; uniform vec4 u_colors_6_1; uniform vec4 u_colors_6_2; uniform vec4 u_colors_6_3;
  uniform vec4 u_colors_6_4; uniform vec4 u_colors_6_5; uniform vec4 u_colors_6_6; uniform vec4 u_colors_6_7;
  
  uniform vec4 u_colors_7_0; uniform vec4 u_colors_7_1; uniform vec4 u_colors_7_2; uniform vec4 u_colors_7_3;
  uniform vec4 u_colors_7_4; uniform vec4 u_colors_7_5; uniform vec4 u_colors_7_6; uniform vec4 u_colors_7_7;
  
  uniform vec4 u_colors_8_0; uniform vec4 u_colors_8_1; uniform vec4 u_colors_8_2; uniform vec4 u_colors_8_3;
  uniform vec4 u_colors_8_4; uniform vec4 u_colors_8_5; uniform vec4 u_colors_8_6; uniform vec4 u_colors_8_7;
  
  uniform vec4 u_colors_9_0; uniform vec4 u_colors_9_1; uniform vec4 u_colors_9_2; uniform vec4 u_colors_9_3;
  uniform vec4 u_colors_9_4; uniform vec4 u_colors_9_5; uniform vec4 u_colors_9_6; uniform vec4 u_colors_9_7;
  
  uniform vec4 u_colors_10_0; uniform vec4 u_colors_10_1; uniform vec4 u_colors_10_2; uniform vec4 u_colors_10_3;
  uniform vec4 u_colors_10_4; uniform vec4 u_colors_10_5; uniform vec4 u_colors_10_6; uniform vec4 u_colors_10_7;

  uniform float u_masterOpacity;
  uniform float u_isBorderAnimated;

  const float PI = 3.14159265359;
  float smooth(float t) { return t * t * (3.0 - 2.0 * t); }
  
  // Unrolled gradient color functions for each color set
  vec4 getGradientColor0(float progress) {
    float t = progress * 7.0;
    if (t < 1.0) return mix(u_colors_0_0, u_colors_0_1, t);
    if (t < 2.0) return mix(u_colors_0_1, u_colors_0_2, t - 1.0);
    if (t < 3.0) return mix(u_colors_0_2, u_colors_0_3, t - 2.0);
    if (t < 4.0) return mix(u_colors_0_3, u_colors_0_4, t - 3.0);
    if (t < 5.0) return mix(u_colors_0_4, u_colors_0_5, t - 4.0);
    if (t < 6.0) return mix(u_colors_0_5, u_colors_0_6, t - 5.0);
    return mix(u_colors_0_6, u_colors_0_7, t - 6.0);
  }
  
  vec4 getGradientColor1(float progress) {
    float t = progress * 7.0;
    if (t < 1.0) return mix(u_colors_1_0, u_colors_1_1, t);
    if (t < 2.0) return mix(u_colors_1_1, u_colors_1_2, t - 1.0);
    if (t < 3.0) return mix(u_colors_1_2, u_colors_1_3, t - 2.0);
    if (t < 4.0) return mix(u_colors_1_3, u_colors_1_4, t - 3.0);
    if (t < 5.0) return mix(u_colors_1_4, u_colors_1_5, t - 4.0);
    if (t < 6.0) return mix(u_colors_1_5, u_colors_1_6, t - 5.0);
    return mix(u_colors_1_6, u_colors_1_7, t - 6.0);
  }
  
  vec4 getGradientColor2(float progress) {
    float t = progress * 7.0;
    if (t < 1.0) return mix(u_colors_2_0, u_colors_2_1, t);
    if (t < 2.0) return mix(u_colors_2_1, u_colors_2_2, t - 1.0);
    if (t < 3.0) return mix(u_colors_2_2, u_colors_2_3, t - 2.0);
    if (t < 4.0) return mix(u_colors_2_3, u_colors_2_4, t - 3.0);
    if (t < 5.0) return mix(u_colors_2_4, u_colors_2_5, t - 4.0);
    if (t < 6.0) return mix(u_colors_2_5, u_colors_2_6, t - 5.0);
    return mix(u_colors_2_6, u_colors_2_7, t - 6.0);
  }
  
  vec4 getGradientColor3(float progress) {
    float t = progress * 7.0;
    if (t < 1.0) return mix(u_colors_3_0, u_colors_3_1, t);
    if (t < 2.0) return mix(u_colors_3_1, u_colors_3_2, t - 1.0);
    if (t < 3.0) return mix(u_colors_3_2, u_colors_3_3, t - 2.0);
    if (t < 4.0) return mix(u_colors_3_3, u_colors_3_4, t - 3.0);
    if (t < 5.0) return mix(u_colors_3_4, u_colors_3_5, t - 4.0);
    if (t < 6.0) return mix(u_colors_3_5, u_colors_3_6, t - 5.0);
    return mix(u_colors_3_6, u_colors_3_7, t - 6.0);
  }
  
  vec4 getGradientColor4(float progress) {
    float t = progress * 7.0;
    if (t < 1.0) return mix(u_colors_4_0, u_colors_4_1, t);
    if (t < 2.0) return mix(u_colors_4_1, u_colors_4_2, t - 1.0);
    if (t < 3.0) return mix(u_colors_4_2, u_colors_4_3, t - 2.0);
    if (t < 4.0) return mix(u_colors_4_3, u_colors_4_4, t - 3.0);
    if (t < 5.0) return mix(u_colors_4_4, u_colors_4_5, t - 4.0);
    if (t < 6.0) return mix(u_colors_4_5, u_colors_4_6, t - 5.0);
    return mix(u_colors_4_6, u_colors_4_7, t - 6.0);
  }
  
  vec4 getGradientColor5(float progress) {
    float t = progress * 7.0;
    if (t < 1.0) return mix(u_colors_5_0, u_colors_5_1, t);
    if (t < 2.0) return mix(u_colors_5_1, u_colors_5_2, t - 1.0);
    if (t < 3.0) return mix(u_colors_5_2, u_colors_5_3, t - 2.0);
    if (t < 4.0) return mix(u_colors_5_3, u_colors_5_4, t - 3.0);
    if (t < 5.0) return mix(u_colors_5_4, u_colors_5_5, t - 4.0);
    if (t < 6.0) return mix(u_colors_5_5, u_colors_5_6, t - 5.0);
    return mix(u_colors_5_6, u_colors_5_7, t - 6.0);
  }
  
  vec4 getGradientColor6(float progress) {
    float t = progress * 7.0;
    if (t < 1.0) return mix(u_colors_6_0, u_colors_6_1, t);
    if (t < 2.0) return mix(u_colors_6_1, u_colors_6_2, t - 1.0);
    if (t < 3.0) return mix(u_colors_6_2, u_colors_6_3, t - 2.0);
    if (t < 4.0) return mix(u_colors_6_3, u_colors_6_4, t - 3.0);
    if (t < 5.0) return mix(u_colors_6_4, u_colors_6_5, t - 4.0);
    if (t < 6.0) return mix(u_colors_6_5, u_colors_6_6, t - 5.0);
    return mix(u_colors_6_6, u_colors_6_7, t - 6.0);
  }
  
  vec4 getGradientColor7(float progress) {
    float t = progress * 7.0;
    if (t < 1.0) return mix(u_colors_7_0, u_colors_7_1, t);
    if (t < 2.0) return mix(u_colors_7_1, u_colors_7_2, t - 1.0);
    if (t < 3.0) return mix(u_colors_7_2, u_colors_7_3, t - 2.0);
    if (t < 4.0) return mix(u_colors_7_3, u_colors_7_4, t - 3.0);
    if (t < 5.0) return mix(u_colors_7_4, u_colors_7_5, t - 4.0);
    if (t < 6.0) return mix(u_colors_7_5, u_colors_7_6, t - 5.0);
    return mix(u_colors_7_6, u_colors_7_7, t - 6.0);
  }
  
  vec4 getGradientColor8(float progress) {
    float t = progress * 7.0;
    if (t < 1.0) return mix(u_colors_8_0, u_colors_8_1, t);
    if (t < 2.0) return mix(u_colors_8_1, u_colors_8_2, t - 1.0);
    if (t < 3.0) return mix(u_colors_8_2, u_colors_8_3, t - 2.0);
    if (t < 4.0) return mix(u_colors_8_3, u_colors_8_4, t - 3.0);
    if (t < 5.0) return mix(u_colors_8_4, u_colors_8_5, t - 4.0);
    if (t < 6.0) return mix(u_colors_8_5, u_colors_8_6, t - 5.0);
    return mix(u_colors_8_6, u_colors_8_7, t - 6.0);
  }
  
  vec4 getGradientColor9(float progress) {
    float t = progress * 7.0;
    if (t < 1.0) return mix(u_colors_9_0, u_colors_9_1, t);
    if (t < 2.0) return mix(u_colors_9_1, u_colors_9_2, t - 1.0);
    if (t < 3.0) return mix(u_colors_9_2, u_colors_9_3, t - 2.0);
    if (t < 4.0) return mix(u_colors_9_3, u_colors_9_4, t - 3.0);
    if (t < 5.0) return mix(u_colors_9_4, u_colors_9_5, t - 4.0);
    if (t < 6.0) return mix(u_colors_9_5, u_colors_9_6, t - 5.0);
    return mix(u_colors_9_6, u_colors_9_7, t - 6.0);
  }
  
  vec4 getGradientColor10(float progress) {
    float t = progress * 7.0;
    if (t < 1.0) return mix(u_colors_10_0, u_colors_10_1, t);
    if (t < 2.0) return mix(u_colors_10_1, u_colors_10_2, t - 1.0);
    if (t < 3.0) return mix(u_colors_10_2, u_colors_10_3, t - 2.0);
    if (t < 4.0) return mix(u_colors_10_3, u_colors_10_4, t - 3.0);
    if (t < 5.0) return mix(u_colors_10_4, u_colors_10_5, t - 4.0);
    if (t < 6.0) return mix(u_colors_10_5, u_colors_10_6, t - 5.0);
    return mix(u_colors_10_6, u_colors_10_7, t - 6.0);
  }
  
  float sdfRoundedBox(vec2 p, vec2 b, float r) { vec2 q=abs(p)-b+r;return min(max(q.x,q.y),0.0)+length(max(q,0.0))-r; }
  float calculatePerimeterProgress(vec2 p, vec2 b, float r) { float w=b.x-r;float h=b.y-r;float c=PI*r/2.0;float H=2.0*w;float V=2.0*h;float s0_end=c;float s1_end=s0_end+H;float s2_end=s1_end+c;float s3_end=s2_end+V;float s4_end=s3_end+c;float s5_end=s4_end+H;float s6_end=s5_end+c;float perimeter=s6_end+V;if(perimeter==0.0)return 0.0;float dist=0.0;if(p.x<-w){if(p.y<-h){vec2 corner_p=p-vec2(-w,-h);dist=c*((atan(corner_p.y,corner_p.x)+PI)/(PI/2.0));}else if(p.y>h){vec2 corner_p=p-vec2(-w,h);dist=s5_end+c*((atan(corner_p.y,corner_p.x)-PI/2.0)/(PI/2.0));}else{dist=s6_end+(h-p.y);}}else if(p.x>w){if(p.y<-h){vec2 corner_p=p-vec2(w,-h);dist=s1_end+c*((atan(corner_p.y,corner_p.x)+PI/2.0)/(PI/2.0));}else if(p.y>h){vec2 corner_p=p-vec2(w,h);dist=s3_end+c*(atan(corner_p.y,corner_p.x)/(PI/2.0));}else{dist=s2_end+(h+p.y);}}else{if(p.y<0.0){dist=s0_end+(w+p.x);}else{dist=s4_end+(w-p.x);}} return dist/perimeter; }
  float getInterpolatedSize(float progress, vec4 sizes) { float segLen=1.0/3.0;if(progress<segLen){return mix(sizes.x,sizes.y,smooth(progress/segLen));}else if(progress<2.0*segLen){return mix(sizes.y,sizes.z,smooth((progress-segLen)/segLen));}else{return mix(sizes.z,sizes.w,smooth((progress-2.0*segLen)/segLen));} }
  float gaussian(float x, float mu, float sigma) { if(sigma<=0.0)return 0.0;return exp(-(pow(x-mu,2.0))/(2.0*pow(sigma,2.0))); }
  
  vec4 main(vec2 fragCoord) {
    vec2 center = u_resolution * 0.5;
    vec2 p = fragCoord - center;
    vec2 b = u_rectSize * 0.5;
    float d = sdfRoundedBox(p, b, u_cornerRadius);
    float perimeterProgress = calculatePerimeterProgress(p, b, u_cornerRadius);
    
    vec4 behindGlow = vec4(0.0);
    vec4 frontGlow = vec4(0.0);
    
    // Unrolled layer processing - layer 0
    if (u_layerCount > 0) {
      float animatedProgress = fract(perimeterProgress - u_layerProgress_0 + u_relativeOffset_0);
      if (animatedProgress <= u_coverage_0 && u_coverage_0 > 0.0) {
        float segmentProgress = animatedProgress / u_coverage_0;
        float currentGlowSize = getInterpolatedSize(segmentProgress, u_glowSizes_0);
        float calculatedOpacity = gaussian(abs(d), 0.0, currentGlowSize);
        if (d > 0.0 && u_placements_0 == 1.0) calculatedOpacity = 0.0;
        if (calculatedOpacity > 0.0) {
          vec4 color = getGradientColor1(segmentProgress);
          vec4 glowComponent = color * calculatedOpacity * u_opacity_0;
          if (u_placements_0 == 0.0) behindGlow += glowComponent; else frontGlow += glowComponent;
        }
      }
    }
    
    // Layer 1
    if (u_layerCount > 1) {
      float animatedProgress = fract(perimeterProgress - u_layerProgress_1 + u_relativeOffset_1);
      if (animatedProgress <= u_coverage_1 && u_coverage_1 > 0.0) {
        float segmentProgress = animatedProgress / u_coverage_1;
        float currentGlowSize = getInterpolatedSize(segmentProgress, u_glowSizes_1);
        float calculatedOpacity = gaussian(abs(d), 0.0, currentGlowSize);
        if (d > 0.0 && u_placements_1 == 1.0) calculatedOpacity = 0.0;
        if (calculatedOpacity > 0.0) {
          vec4 color = getGradientColor2(segmentProgress);
          vec4 glowComponent = color * calculatedOpacity * u_opacity_1;
          if (u_placements_1 == 0.0) behindGlow += glowComponent; else frontGlow += glowComponent;
        }
      }
    }
    
    // Layer 2
    if (u_layerCount > 2) {
      float animatedProgress = fract(perimeterProgress - u_layerProgress_2 + u_relativeOffset_2);
      if (animatedProgress <= u_coverage_2 && u_coverage_2 > 0.0) {
        float segmentProgress = animatedProgress / u_coverage_2;
        float currentGlowSize = getInterpolatedSize(segmentProgress, u_glowSizes_2);
        float calculatedOpacity = gaussian(abs(d), 0.0, currentGlowSize);
        if (d > 0.0 && u_placements_2 == 1.0) calculatedOpacity = 0.0;
        if (calculatedOpacity > 0.0) {
          vec4 color = getGradientColor3(segmentProgress);
          vec4 glowComponent = color * calculatedOpacity * u_opacity_2;
          if (u_placements_2 == 0.0) behindGlow += glowComponent; else frontGlow += glowComponent;
        }
      }
    }
    
    // Layer 3
    if (u_layerCount > 3) {
      float animatedProgress = fract(perimeterProgress - u_layerProgress_3 + u_relativeOffset_3);
      if (animatedProgress <= u_coverage_3 && u_coverage_3 > 0.0) {
        float segmentProgress = animatedProgress / u_coverage_3;
        float currentGlowSize = getInterpolatedSize(segmentProgress, u_glowSizes_3);
        float calculatedOpacity = gaussian(abs(d), 0.0, currentGlowSize);
        if (d > 0.0 && u_placements_3 == 1.0) calculatedOpacity = 0.0;
        if (calculatedOpacity > 0.0) {
          vec4 color = getGradientColor4(segmentProgress);
          vec4 glowComponent = color * calculatedOpacity * u_opacity_3;
          if (u_placements_3 == 0.0) behindGlow += glowComponent; else frontGlow += glowComponent;
        }
      }
    }
    
    // Layer 4
    if (u_layerCount > 4) {
      float animatedProgress = fract(perimeterProgress - u_layerProgress_4 + u_relativeOffset_4);
      if (animatedProgress <= u_coverage_4 && u_coverage_4 > 0.0) {
        float segmentProgress = animatedProgress / u_coverage_4;
        float currentGlowSize = getInterpolatedSize(segmentProgress, u_glowSizes_4);
        float calculatedOpacity = gaussian(abs(d), 0.0, currentGlowSize);
        if (d > 0.0 && u_placements_4 == 1.0) calculatedOpacity = 0.0;
        if (calculatedOpacity > 0.0) {
          vec4 color = getGradientColor5(segmentProgress);
          vec4 glowComponent = color * calculatedOpacity * u_opacity_4;
          if (u_placements_4 == 0.0) behindGlow += glowComponent; else frontGlow += glowComponent;
        }
      }
    }
    
    // Layer 5
    if (u_layerCount > 5) {
      float animatedProgress = fract(perimeterProgress - u_layerProgress_5 + u_relativeOffset_5);
      if (animatedProgress <= u_coverage_5 && u_coverage_5 > 0.0) {
        float segmentProgress = animatedProgress / u_coverage_5;
        float currentGlowSize = getInterpolatedSize(segmentProgress, u_glowSizes_5);
        float calculatedOpacity = gaussian(abs(d), 0.0, currentGlowSize);
        if (d > 0.0 && u_placements_5 == 1.0) calculatedOpacity = 0.0;
        if (calculatedOpacity > 0.0) {
          vec4 color = getGradientColor6(segmentProgress);
          vec4 glowComponent = color * calculatedOpacity * u_opacity_5;
          if (u_placements_5 == 0.0) behindGlow += glowComponent; else frontGlow += glowComponent;
        }
      }
    }
    
    // Layer 6
    if (u_layerCount > 6) {
      float animatedProgress = fract(perimeterProgress - u_layerProgress_6 + u_relativeOffset_6);
      if (animatedProgress <= u_coverage_6 && u_coverage_6 > 0.0) {
        float segmentProgress = animatedProgress / u_coverage_6;
        float currentGlowSize = getInterpolatedSize(segmentProgress, u_glowSizes_6);
        float calculatedOpacity = gaussian(abs(d), 0.0, currentGlowSize);
        if (d > 0.0 && u_placements_6 == 1.0) calculatedOpacity = 0.0;
        if (calculatedOpacity > 0.0) {
          vec4 color = getGradientColor7(segmentProgress);
          vec4 glowComponent = color * calculatedOpacity * u_opacity_6;
          if (u_placements_6 == 0.0) behindGlow += glowComponent; else frontGlow += glowComponent;
        }
      }
    }
    
    // Layer 7
    if (u_layerCount > 7) {
      float animatedProgress = fract(perimeterProgress - u_layerProgress_7 + u_relativeOffset_7);
      if (animatedProgress <= u_coverage_7 && u_coverage_7 > 0.0) {
        float segmentProgress = animatedProgress / u_coverage_7;
        float currentGlowSize = getInterpolatedSize(segmentProgress, u_glowSizes_7);
        float calculatedOpacity = gaussian(abs(d), 0.0, currentGlowSize);
        if (d > 0.0 && u_placements_7 == 1.0) calculatedOpacity = 0.0;
        if (calculatedOpacity > 0.0) {
          vec4 color = getGradientColor8(segmentProgress);
          vec4 glowComponent = color * calculatedOpacity * u_opacity_7;
          if (u_placements_7 == 0.0) behindGlow += glowComponent; else frontGlow += glowComponent;
        }
      }
    }
    
    // Layer 8
    if (u_layerCount > 8) {
      float animatedProgress = fract(perimeterProgress - u_layerProgress_8 + u_relativeOffset_8);
      if (animatedProgress <= u_coverage_8 && u_coverage_8 > 0.0) {
        float segmentProgress = animatedProgress / u_coverage_8;
        float currentGlowSize = getInterpolatedSize(segmentProgress, u_glowSizes_8);
        float calculatedOpacity = gaussian(abs(d), 0.0, currentGlowSize);
        if (d > 0.0 && u_placements_8 == 1.0) calculatedOpacity = 0.0;
        if (calculatedOpacity > 0.0) {
          vec4 color = getGradientColor9(segmentProgress);
          vec4 glowComponent = color * calculatedOpacity * u_opacity_8;
          if (u_placements_8 == 0.0) behindGlow += glowComponent; else frontGlow += glowComponent;
        }
      }
    }
    
    // Layer 9
    if (u_layerCount > 9) {
      float animatedProgress = fract(perimeterProgress - u_layerProgress_9 + u_relativeOffset_9);
      if (animatedProgress <= u_coverage_9 && u_coverage_9 > 0.0) {
        float segmentProgress = animatedProgress / u_coverage_9;
        float currentGlowSize = getInterpolatedSize(segmentProgress, u_glowSizes_9);
        float calculatedOpacity = gaussian(abs(d), 0.0, currentGlowSize);
        if (d > 0.0 && u_placements_9 == 1.0) calculatedOpacity = 0.0;
        if (calculatedOpacity > 0.0) {
          vec4 color = getGradientColor10(segmentProgress);
          vec4 glowComponent = color * calculatedOpacity * u_opacity_9;
          if (u_placements_9 == 0.0) behindGlow += glowComponent; else frontGlow += glowComponent;
        }
      }
    }
    
    vec4 finalColor = behindGlow;
    if (d <= 0.0) {
        finalColor = mix(finalColor, u_backgroundColor, u_backgroundColor.a);
    }
    finalColor += frontGlow;
    
    if (u_isBorderAnimated > 0.5 && u_borderWidth > 0.0) {
      float borderDist = abs(d);
      float halfWidth = u_borderWidth / 2.0;
      float borderStrength = 1.0 - smoothstep(halfWidth - 1.0, halfWidth + 1.0, borderDist);
      if (borderStrength > 0.0) {
        float borderAnimatedProgress = fract(perimeterProgress - u_borderProgress);
        vec4 borderColor = getGradientColor0(borderAnimatedProgress);
        finalColor = mix(finalColor, borderColor, borderStrength);
      }
    }

    return finalColor * u_masterOpacity;
  }
`;

// Select shader based on platform
const sksl = Platform.OS === 'android' ? skslAndroid : skslIOS;

const processColorsWorklet = (colors: RGBColor[]): number[] => { 'worklet'; if (colors.length === 0) return Array(8 * 4).fill(0); const seamless = colors.length > 1 ? [...colors, colors[0]] : [...colors, ...colors]; const finalColors: number[] = []; for (let i = 0; i < 8; i++) { const p = i / 7.0; const c = getGradientColorWorklet(p, seamless); finalColors.push(c.r / 255, c.g / 255, c.b / 255, 1.0); } return finalColors; };

export interface UnifiedSkiaGlowProps {
  layout: Layout;
  masterOpacity: SharedValue<number>;
  progress: SharedValue<number>;
  fromConfig: SharedValue<GlowConfig>;
  toConfig: SharedValue<GlowConfig>;
}

const GLOW_CANVAS_MARGIN = 100;

export const UnifiedSkiaGlow: FC<UnifiedSkiaGlowProps> = ({ layout, masterOpacity, progress, fromConfig, toConfig }) => {
    const animatedEffect = useMemo((): SkRuntimeEffect | null => {
        if (Skia.RuntimeEffect) {
            return Skia.RuntimeEffect.Make(sksl);
        }
        return null;
    }, []);

    const borderProgress = useSharedValue(0);
    const layerProgress = useSharedValue(Array(MAX_SKIA_LAYERS).fill(0));

    const interpolatedSpeeds = useDerivedValue(() => {
        'worklet';
        const p = progress.value;
        const from = fromConfig.value;
        const to = toConfig.value;
        const animSpeed = interpolateNumber(from.animationSpeed ?? 0.7, to.animationSpeed ?? 0.7, p);
        const borderSpeedMult = interpolateNumber(from.borderSpeedMultiplier ?? 1.0, to.borderSpeedMultiplier ?? 1.0, p);
        const layerSpeedMults = [];
        const toLayers = to.glowLayers ?? [];
        const fromLayers = from.glowLayers ?? [];
        for (let i = 0; i < MAX_SKIA_LAYERS; i++) {
            if (i >= toLayers.length) {
                layerSpeedMults.push(0);
                continue;
            }
            const fromLayer = fromLayers[i] ?? {};
            const toLayer = toLayers[i] ?? {};
            layerSpeedMults.push(interpolateNumber(fromLayer.speedMultiplier ?? (toLayer.speedMultiplier ?? 1.0), toLayer.speedMultiplier ?? 1.0, p));
        }
        return { animSpeed, borderSpeedMult, layerSpeedMults };
    });

    useFrameCallback((frameInfo) => {
        'worklet';
        if (frameInfo.timeSincePreviousFrame === null) return;
        const deltaTime = frameInfo.timeSincePreviousFrame / 1000;
        const speeds = interpolatedSpeeds.value;
        const speedFactor = 0.166;
        const borderDelta = deltaTime * speedFactor * speeds.animSpeed * speeds.borderSpeedMult;
        borderProgress.value = (borderProgress.value + borderDelta) % 1.0;
        const currentLayerProgress = [...layerProgress.value];
        for (let i = 0; i < MAX_SKIA_LAYERS; i++) {
            const layerDelta = deltaTime * speedFactor * speeds.animSpeed * speeds.layerSpeedMults[i];
            currentLayerProgress[i] = (currentLayerProgress[i] + layerDelta) % 1.0;
        }
        layerProgress.value = currentLayerProgress;
    });

    const uniforms = useDerivedValue(() => {
        'worklet';
        const p = progress.value;
        const from = fromConfig.value;
        const to = toConfig.value;
        const cornerRadius = interpolateNumber(from.cornerRadius ?? 10, to.cornerRadius ?? 10, p);
        const outlineWidth = interpolateNumber(from.outlineWidth ?? 2, to.outlineWidth ?? 2, p);
        const fromBg = parseColorToRgbaWorklet(from.backgroundColor ?? 'transparent');
        const toBg = parseColorToRgbaWorklet(to.backgroundColor ?? 'transparent');
        const iBg = interpolateRgbaWorklet(fromBg, toBg, p);
        const backgroundColor = [iBg.r / 255, iBg.g / 255, iBg.b / 255, iBg.a];
        const coverage: number[] = [], glowSizes: number[] = [], opacity: number[] = [],
              relativeOffset: number[] = [], placements: number[] = [];
        const layerColors: number[][] = [];
        const fromLayers = from.glowLayers ?? [];
        const toLayers = to.glowLayers ?? [];
        const layerCount = toLayers.length;
        for (let i = 0; i < MAX_SKIA_LAYERS; i++) {
            if (i >= layerCount) {
                coverage.push(0); opacity.push(0); relativeOffset.push(0); placements.push(0);
                glowSizes.push(0, 0, 0, 0); layerColors.push(Array(32).fill(0));
                continue;
            }
            const fromLayer = fromLayers[i] ?? {};
            const toLayer = toLayers[i] ?? {};
            opacity.push(interpolateNumber(fromLayer.opacity ?? (toLayer.opacity ?? 0.5), toLayer.opacity ?? 0.5, p));
            coverage.push(interpolateNumber(fromLayer.coverage ?? (toLayer.coverage ?? 1.0), toLayer.coverage ?? 1.0, p));
            relativeOffset.push(interpolateNumber(fromLayer.relativeOffset ?? (toLayer.relativeOffset ?? 0), toLayer.relativeOffset ?? 0, p));
            const fromSize = Array.isArray(fromLayer.glowSize) ? fromLayer.glowSize : [fromLayer.glowSize ?? 0];
            const toSize = Array.isArray(toLayer.glowSize) ? toLayer.glowSize : [toLayer.glowSize ?? 0];
            glowSizes.push(...getGlowSizeVec4Worklet(interpolateNumberArray(fromSize, toSize, p)));
            const iColors = interpolateColorArrayWorklet(Array.isArray(fromLayer.colors) ? fromLayer.colors : [], Array.isArray(toLayer.colors) ? toLayer.colors : [], p);
            layerColors.push(processColorsWorklet(iColors));
            const placementMap: Record<GlowPlacement, number> = { 'behind': 0.0, 'inside': 1.0, 'over': 2.0 };
            const placementKey = (toLayer.glowPlacement ?? 'behind') as GlowPlacement;
            placements.push(placementMap[placementKey]);
        }
        const fromBorder = Array.isArray(from.borderColor) ? from.borderColor : (from.borderColor ? [from.borderColor] : []);
        const toBorder = Array.isArray(to.borderColor) ? to.borderColor : (to.borderColor ? [to.borderColor] : []);
        const iBorder = interpolateColorArrayWorklet(fromBorder, toBorder, p);

        // For Android, return flattened uniforms
        if (Platform.OS === 'android') {
            const borderColorsFlat = processColorsWorklet(iBorder);
            return {
                u_resolution: [layout.width + GLOW_CANVAS_MARGIN * 2, layout.height + GLOW_CANVAS_MARGIN * 2],
                u_rectSize: [layout.width, layout.height],
                u_cornerRadius: Math.min(cornerRadius, layout.width / 2, layout.height / 2),
                u_backgroundColor: backgroundColor,
                u_borderWidth: outlineWidth,
                u_borderProgress: borderProgress.value,
                u_layerCount: layerCount,
                // Flattened layer arrays
                u_coverage_0: coverage[0], u_coverage_1: coverage[1], u_coverage_2: coverage[2], u_coverage_3: coverage[3], u_coverage_4: coverage[4],
                u_coverage_5: coverage[5], u_coverage_6: coverage[6], u_coverage_7: coverage[7], u_coverage_8: coverage[8], u_coverage_9: coverage[9],
                u_opacity_0: opacity[0], u_opacity_1: opacity[1], u_opacity_2: opacity[2], u_opacity_3: opacity[3], u_opacity_4: opacity[4],
                u_opacity_5: opacity[5], u_opacity_6: opacity[6], u_opacity_7: opacity[7], u_opacity_8: opacity[8], u_opacity_9: opacity[9],
                u_relativeOffset_0: relativeOffset[0], u_relativeOffset_1: relativeOffset[1], u_relativeOffset_2: relativeOffset[2], u_relativeOffset_3: relativeOffset[3], u_relativeOffset_4: relativeOffset[4],
                u_relativeOffset_5: relativeOffset[5], u_relativeOffset_6: relativeOffset[6], u_relativeOffset_7: relativeOffset[7], u_relativeOffset_8: relativeOffset[8], u_relativeOffset_9: relativeOffset[9],
                u_placements_0: placements[0], u_placements_1: placements[1], u_placements_2: placements[2], u_placements_3: placements[3], u_placements_4: placements[4],
                u_placements_5: placements[5], u_placements_6: placements[6], u_placements_7: placements[7], u_placements_8: placements[8], u_placements_9: placements[9],
                u_layerProgress_0: layerProgress.value[0], u_layerProgress_1: layerProgress.value[1], u_layerProgress_2: layerProgress.value[2], u_layerProgress_3: layerProgress.value[3], u_layerProgress_4: layerProgress.value[4],
                u_layerProgress_5: layerProgress.value[5], u_layerProgress_6: layerProgress.value[6], u_layerProgress_7: layerProgress.value[7], u_layerProgress_8: layerProgress.value[8], u_layerProgress_9: layerProgress.value[9],
                u_glowSizes_0: glowSizes.slice(0, 4), u_glowSizes_1: glowSizes.slice(4, 8), u_glowSizes_2: glowSizes.slice(8, 12), u_glowSizes_3: glowSizes.slice(12, 16), u_glowSizes_4: glowSizes.slice(16, 20),
                u_glowSizes_5: glowSizes.slice(20, 24), u_glowSizes_6: glowSizes.slice(24, 28), u_glowSizes_7: glowSizes.slice(28, 32), u_glowSizes_8: glowSizes.slice(32, 36), u_glowSizes_9: glowSizes.slice(36, 40),
                // Flattened color uniforms
                u_colors_0_0: borderColorsFlat.slice(0, 4), u_colors_0_1: borderColorsFlat.slice(4, 8), u_colors_0_2: borderColorsFlat.slice(8, 12), u_colors_0_3: borderColorsFlat.slice(12, 16),
                u_colors_0_4: borderColorsFlat.slice(16, 20), u_colors_0_5: borderColorsFlat.slice(20, 24), u_colors_0_6: borderColorsFlat.slice(24, 28), u_colors_0_7: borderColorsFlat.slice(28, 32),
                u_colors_1_0: layerColors[0].slice(0, 4), u_colors_1_1: layerColors[0].slice(4, 8), u_colors_1_2: layerColors[0].slice(8, 12), u_colors_1_3: layerColors[0].slice(12, 16),
                u_colors_1_4: layerColors[0].slice(16, 20), u_colors_1_5: layerColors[0].slice(20, 24), u_colors_1_6: layerColors[0].slice(24, 28), u_colors_1_7: layerColors[0].slice(28, 32),
                u_colors_2_0: layerColors[1].slice(0, 4), u_colors_2_1: layerColors[1].slice(4, 8), u_colors_2_2: layerColors[1].slice(8, 12), u_colors_2_3: layerColors[1].slice(12, 16),
                u_colors_2_4: layerColors[1].slice(16, 20), u_colors_2_5: layerColors[1].slice(20, 24), u_colors_2_6: layerColors[1].slice(24, 28), u_colors_2_7: layerColors[1].slice(28, 32),
                u_colors_3_0: layerColors[2].slice(0, 4), u_colors_3_1: layerColors[2].slice(4, 8), u_colors_3_2: layerColors[2].slice(8, 12), u_colors_3_3: layerColors[2].slice(12, 16),
                u_colors_3_4: layerColors[2].slice(16, 20), u_colors_3_5: layerColors[2].slice(20, 24), u_colors_3_6: layerColors[2].slice(24, 28), u_colors_3_7: layerColors[2].slice(28, 32),
                u_colors_4_0: layerColors[3].slice(0, 4), u_colors_4_1: layerColors[3].slice(4, 8), u_colors_4_2: layerColors[3].slice(8, 12), u_colors_4_3: layerColors[3].slice(12, 16),
                u_colors_4_4: layerColors[3].slice(16, 20), u_colors_4_5: layerColors[3].slice(20, 24), u_colors_4_6: layerColors[3].slice(24, 28), u_colors_4_7: layerColors[3].slice(28, 32),
                u_colors_5_0: layerColors[4].slice(0, 4), u_colors_5_1: layerColors[4].slice(4, 8), u_colors_5_2: layerColors[4].slice(8, 12), u_colors_5_3: layerColors[4].slice(12, 16),
                u_colors_5_4: layerColors[4].slice(16, 20), u_colors_5_5: layerColors[4].slice(20, 24), u_colors_5_6: layerColors[4].slice(24, 28), u_colors_5_7: layerColors[4].slice(28, 32),
                u_colors_6_0: layerColors[5].slice(0, 4), u_colors_6_1: layerColors[5].slice(4, 8), u_colors_6_2: layerColors[5].slice(8, 12), u_colors_6_3: layerColors[5].slice(12, 16),
                u_colors_6_4: layerColors[5].slice(16, 20), u_colors_6_5: layerColors[5].slice(20, 24), u_colors_6_6: layerColors[5].slice(24, 28), u_colors_6_7: layerColors[5].slice(28, 32),
                u_colors_7_0: layerColors[6].slice(0, 4), u_colors_7_1: layerColors[6].slice(4, 8), u_colors_7_2: layerColors[6].slice(8, 12), u_colors_7_3: layerColors[6].slice(12, 16),
                u_colors_7_4: layerColors[6].slice(16, 20), u_colors_7_5: layerColors[6].slice(20, 24), u_colors_7_6: layerColors[6].slice(24, 28), u_colors_7_7: layerColors[6].slice(28, 32),
                u_colors_8_0: layerColors[7].slice(0, 4), u_colors_8_1: layerColors[7].slice(4, 8), u_colors_8_2: layerColors[7].slice(8, 12), u_colors_8_3: layerColors[7].slice(12, 16),
                u_colors_8_4: layerColors[7].slice(16, 20), u_colors_8_5: layerColors[7].slice(20, 24), u_colors_8_6: layerColors[7].slice(24, 28), u_colors_8_7: layerColors[7].slice(28, 32),
                u_colors_9_0: layerColors[8].slice(0, 4), u_colors_9_1: layerColors[8].slice(4, 8), u_colors_9_2: layerColors[8].slice(8, 12), u_colors_9_3: layerColors[8].slice(12, 16),
                u_colors_9_4: layerColors[8].slice(16, 20), u_colors_9_5: layerColors[8].slice(20, 24), u_colors_9_6: layerColors[8].slice(24, 28), u_colors_9_7: layerColors[8].slice(28, 32),
                u_colors_10_0: layerColors[9].slice(0, 4), u_colors_10_1: layerColors[9].slice(4, 8), u_colors_10_2: layerColors[9].slice(8, 12), u_colors_10_3: layerColors[9].slice(12, 16),
                u_colors_10_4: layerColors[9].slice(16, 20), u_colors_10_5: layerColors[9].slice(20, 24), u_colors_10_6: layerColors[9].slice(24, 28), u_colors_10_7: layerColors[9].slice(28, 32),
                u_masterOpacity: masterOpacity.value,
                u_isBorderAnimated: toBorder.length > 1 ? 1.0 : 0.0,
            };
        }

        // iOS - original format with arrays
        return {
            u_resolution: [layout.width + GLOW_CANVAS_MARGIN * 2, layout.height + GLOW_CANVAS_MARGIN * 2],
            u_rectSize: [layout.width, layout.height],
            u_cornerRadius: Math.min(cornerRadius, layout.width / 2, layout.height / 2),
            u_backgroundColor: backgroundColor,
            u_borderWidth: outlineWidth,
            u_borderProgress: borderProgress.value,
            u_layerCount: layerCount,
            u_coverage: coverage, u_opacity: opacity, u_relativeOffset: relativeOffset,
            u_glowSizes: glowSizes, u_placements: placements,
            u_layerProgress: layerProgress.value,
            u_colors_0: processColorsWorklet(iBorder),
            u_colors_1: layerColors[0], u_colors_2: layerColors[1], u_colors_3: layerColors[2],
            u_colors_4: layerColors[3], u_colors_5: layerColors[4], u_colors_6: layerColors[5],
            u_colors_7: layerColors[6], u_colors_8: layerColors[7], u_colors_9: layerColors[8],
            u_colors_10: layerColors[9],
            u_masterOpacity: masterOpacity.value,
            u_isBorderAnimated: toBorder.length > 1 ? 1.0 : 0.0,
        };
    }, [layout, progress, fromConfig, toConfig, masterOpacity]);

    if (!animatedEffect || layout.width <= 0 || layout.height <= 0) {
        return null;
    }

    return (
        <View style={[StyleSheet.absoluteFill, { left: -GLOW_CANVAS_MARGIN, top: -GLOW_CANVAS_MARGIN, width: layout.width + GLOW_CANVAS_MARGIN * 2, height: layout.height + GLOW_CANVAS_MARGIN * 2 }]} pointerEvents="none">
            <Animated.View style={StyleSheet.absoluteFill}>
                <Canvas style={StyleSheet.absoluteFill}>
                    <Fill>
                        <Shader source={animatedEffect} uniforms={uniforms} />
                    </Fill>
                </Canvas>
            </Animated.View>
        </View>
    );
};
