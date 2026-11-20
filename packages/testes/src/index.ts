// Massa sintética, fábrica de cenários e cópia descartável (M01 em diante). Nunca dado pessoal real.
export function sequenciaSintetica(prefixo: string, quantidade: number): string[] {
  return Array.from({ length: quantidade }, (_, i) => `${prefixo}-${String(i + 1).padStart(3, '0')}`);
}
// M04: massa sintética e reprodução das operações do catálogo pelo executor.
export * from './massa/sintetica.js';
export * from './reproducao.js';
// M52.4: os arquivos sintéticos do relógio de ponto (um válido e cinco com defeito).
export * from './m52/afd-sintetico.js';
// M53.1: o simulador do sistema de folha externo (teste de contrato da interface e retornos para o E2E).
export * from './m53/folha-externa.js';
