// Cliente da tela de remuneração variável do profissional (F8, 07-FIN linha 157): mínimo garantido, percentual do
// resultado, metas de produtividade com faixas, custo do prestador e o lançamento na apuração. As gravações vão com o
// CSRF e a Idempotency-Key (uma por intenção de gravar); a recusa de negócio traz o texto do servidor.
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';
import { novaChave } from './api-repasse.js';

const R = '/api/repasse/remuneracao-variavel';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

interface Vigente {
  id: number;
  profissional: number;
  profissionalNome: string | null;
  evento: number | null;
  eventoNome: string | null;
  inicio: string;
  fim: string | null;
  versao: number;
}
export interface FaixaMeta {
  de: number;
  ate: number | null;
  premio: number;
}
export type FormaPremio = 'percentual_producao' | 'valor_fixo';
export type TipoRegraVariavel = 'minimo' | 'fixo' | 'resultado' | 'meta';

export interface PainelRemuneracaoVariavel {
  minimos: (Vigente & { valorMinimo: number; complementoAutomatico: boolean })[];
  fixos: (Vigente & {
    descricao: string;
    valorMensal: number;
    diaPagamento: number | null;
    lancamentoAutomatico: boolean;
  })[];
  resultados: (Vigente & { centroCusto: number | null; centroNome: string | null; percentual: number })[];
  metas: (Vigente & {
    indicador: number;
    indicadorCodigo: string;
    indicadorDescricao: string;
    unidade: string | null;
    sentido: string;
    centroNome: string | null;
    forma: FormaPremio;
    peso: number;
    faixas: FaixaMeta[];
    apurados: { competencia: string; valor: number; fonte: string }[];
  })[];
  custos: {
    id: number;
    descricao: string;
    natureza: string;
    forma: string;
    valor: number | null;
    percentual: number | null;
    faixaInicial: number | null;
    faixaFinal: number | null;
    frequencia: string;
    inicio: string;
    fim: string | null;
  }[];
  eventos: { id: number; codigo: string; nome: string }[];
  indicadores: { id: number; codigo: string; descricao: string; unidade: string | null; sentido: string }[];
  centros: { id: number; codigo: string; nome: string }[];
  apuracoes: { id: number; numero: string; competencia: string; situacao: string }[];
}

export interface SimulacaoRemuneracao {
  apuracao: number;
  competencia: string;
  situacao: string;
  profissionais: {
    profissional: number;
    nome: string;
    producao: number;
    credito: number;
    debito: number;
    pendencias: string[];
    itens: {
      tipo: 'valor_fixo' | 'complemento_minimo' | 'resultado' | 'produtividade' | 'custo';
      regra: number;
      sentido: 'credito' | 'debito';
      valor: number;
      memoria: string;
      referente: string;
      lancado: boolean;
    }[];
  }[];
}

export const lerPainelVariavel = (profissional: number) =>
  ler(`${R}${qs({ profissional })}`, confiar<PainelRemuneracaoVariavel>());
export const simularVariavel = (apuracao: number, profissional: number) =>
  ler(`${R}/simulacao${qs({ apuracao, profissional })}`, confiar<SimulacaoRemuneracao>());
export const incluirMinimo = (corpo: unknown) =>
  enviar(`${R}/minimos`, corpo, confiar<{ id: number }>(), novaChave('rv-minimo'));
export const incluirFixo = (corpo: unknown) =>
  enviar(`${R}/fixos`, corpo, confiar<{ id: number }>(), novaChave('rv-fixo'));
export const incluirResultado = (corpo: unknown) =>
  enviar(`${R}/resultados`, corpo, confiar<{ id: number }>(), novaChave('rv-resultado'));
export const incluirMeta = (corpo: unknown) =>
  enviar(`${R}/metas`, corpo, confiar<{ id: number }>(), novaChave('rv-meta'));
export const informarApurado = (meta: number, corpo: unknown) =>
  enviar(`${R}/metas/${meta}/apurado`, corpo, confiar<{ id: number }>(), novaChave('rv-apurado'));
export const encerrarRegraVariavel = (tipo: TipoRegraVariavel, id: number, versao: number, fim: string) =>
  enviar(`${R}/${tipo}/${id}/encerrar`, { versao, fim }, confiar<{ id: number }>(), novaChave('rv-fim'));
export const lancarVariavel = (apuracao: number, profissional: number) =>
  enviar(
    `${R}/lancar`,
    { apuracao, profissional },
    confiar<{
      lancamentos: number;
      descontos: number;
      credito: number;
      debito: number;
      pendencias: string[];
    }>(),
    novaChave('rv-lancar'),
  );

/** A mesma conferência das faixas do domínio, na hora: ordem, sobreposição e prêmio. */
export function problemasDasFaixas(forma: FormaPremio, faixas: readonly FaixaMeta[]): string[] {
  const p: string[] = [];
  if (!faixas.length) p.push('Informe ao menos uma faixa.');
  const ord = [...faixas].sort((a, b) => a.de - b.de);
  ord.forEach((f, i) => {
    if (f.ate !== null && f.ate < f.de) p.push(`A faixa ${i + 1} termina antes de começar.`);
    if (!(f.premio > 0)) p.push(`A faixa ${i + 1} precisa de prêmio maior que zero.`);
    if (forma === 'percentual_producao' && f.premio > 100)
      p.push(`A faixa ${i + 1} passa de 100% da produção.`);
    const ant = ord[i - 1];
    if (ant && (ant.ate === null || ant.ate >= f.de)) p.push(`As faixas ${i} e ${i + 1} se sobrepõem.`);
  });
  return p;
}
