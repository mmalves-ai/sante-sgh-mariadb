// Preset do OpenVue 1 a partir dos tokens de marca (DP-51; ajustes da sonda: texto secundário surface.700
// no claro, primária do escuro primary.100, botão secundário surface.800 no claro e fundo 700/800 no escuro).
import { definePreset } from '@openvue/themes';
import Aura from '@openvue/themes/aura';
import { BRANCO, CLINICA, type CoresDaMarca, escala } from '../tokens/cores.js';

export function criarPresetMarca(marca: CoresDaMarca): ReturnType<typeof definePreset> {
  const vinho = escala(marca.corPrimaria);
  const cinza = escala(marca.corSecundaria);
  return definePreset(Aura, {
    semantic: {
      primary: vinho,
      focusRing: { width: '2px', style: 'solid', color: '{primary.color}', offset: '2px' },
      colorScheme: {
        light: {
          surface: { 0: BRANCO, ...cinza },
          primary: {
            color: '{primary.500}',
            contrastColor: '{surface.0}',
            hoverColor: '{primary.600}',
            activeColor: '{primary.700}',
          },
          text: { color: '{surface.950}', mutedColor: '{surface.700}', hoverColor: '{surface.950}' },
          formField: {
            placeholderColor: '{surface.700}',
            floatLabelColor: '{surface.700}',
            iconColor: '{surface.700}',
            borderColor: '{surface.600}',
          },
        },
        dark: {
          surface: { 0: BRANCO, ...cinza },
          primary: {
            color: '{primary.100}',
            contrastColor: '{surface.950}',
            hoverColor: '{primary.50}',
            activeColor: '{primary.50}',
          },
          text: { color: '{surface.0}', mutedColor: '{surface.300}', hoverColor: '{surface.0}' },
          // Fundo de cartões, diálogos e painéis no escuro: surface.950, onde o cinza da marca (texto
          // secundário) tem 5,2:1; no 900 do Aura ficaria com 3,8:1 (axe da paleta, M07).
          content: {
            background: '{surface.950}',
            hoverBackground: '{surface.900}',
            borderColor: '{surface.700}',
          },
          overlay: {
            select: { background: '{surface.950}', borderColor: '{surface.700}' },
            popover: { background: '{surface.950}', borderColor: '{surface.700}' },
            modal: { background: '{surface.950}', borderColor: '{surface.700}' },
          },
          formField: {
            placeholderColor: '{surface.300}',
            floatLabelColor: '{surface.300}',
            iconColor: '{surface.300}',
          },
        },
      },
    },
    components: {
      button: {
        colorScheme: {
          light: {
            root: {
              secondary: {
                color: '{surface.800}',
                hoverColor: '{surface.900}',
                activeColor: '{surface.900}',
              },
            },
            // Ação destrutiva: o vermelho de alerta dos tokens (≥ 4,5:1), nunca o vinho nem o red.500 do Aura.
            outlined: {
              danger: {
                color: CLINICA.claro.alerta,
                borderColor: CLINICA.claro.alerta,
                hoverBackground: CLINICA.claro.alertaSuave,
                activeBackground: CLINICA.claro.alertaSuave,
              },
            },
          },
          dark: {
            root: {
              secondary: {
                background: '{surface.700}',
                hoverBackground: '{surface.800}',
                activeBackground: '{surface.900}',
                color: '{surface.0}',
                hoverColor: '{surface.0}',
                activeColor: '{surface.0}',
              },
            },
            outlined: {
              danger: {
                color: CLINICA.escuro.alerta,
                borderColor: CLINICA.escuro.alerta,
                hoverBackground: CLINICA.escuro.alertaSuave,
                activeBackground: CLINICA.escuro.alertaSuave,
              },
            },
          },
        },
      },
    },
  });
}
