// Exportação dos profissionais para o cadastro nacional de estabelecimentos (C3-011, item 3). Na prática de mercado o
// sistema do hospital gera o arquivo XML dos profissionais (identificação, ocupação, vínculo e carga horária) que o
// estabelecimento importa no sistema do cadastro nacional, em vez de digitar cada lotação. A crítica vem antes: o
// profissional com dado obrigatório faltando ou inválido fica fora do arquivo e aparece na lista de pendências.
// O leiaute oficial de importação é publicado pelo gestor nacional e depende da versão do sistema do cadastro: o
// arquivo sai na estrutura abaixo, marcada com a versão do leiaute, e a confirmação dos nomes contra o esquema oficial
// (XSD) fica no aviso da central de integrações (integração 'cnes', função 'exportacao-profissionais-cnes').
import { cnsValido, cpfValido } from '@sgh/contratos';

/** Versão do leiaute do arquivo gerado; muda quando a estrutura for confirmada contra o esquema oficial. */
export const LEIAUTE_EXPORTACAO_CNES = { nome: 'profissionais-cadastro-nacional', versao: '1.0' } as const;

/** O que pedir para confirmar o leiaute (mostrado na tela, junto do aviso da central de integrações). */
export const AVISO_LEIAUTE_EXPORTACAO_CNES =
  'Leiaute a confirmar: passe à equipe de desenvolvimento o esquema XML (XSD) e o manual de importação de ' +
  'profissionais da versão do sistema do cadastro nacional em uso, pedidos ao gestor (secretaria de saúde) ou ao ' +
  'suporte do cadastro nacional.';

export interface ProfissionalParaExportacaoCnes {
  readonly nome: string;
  readonly cpf: string | null;
  readonly cns: string | null;
  readonly cbo: string | null;
  readonly vinculo: { readonly vinculo: string; readonly tipo: string; readonly subtipo: string } | null;
  readonly cargaAmbulatorial: number;
  readonly cargaHospitalar: number;
  readonly cargaOutros: number;
  readonly conselho: { readonly sigla: string; readonly uf: string; readonly numero: string } | null;
  readonly atendeSus: boolean;
}

export interface EntradaExportacaoCnes {
  readonly codigoCnes: string | null;
  readonly cnpj: string | null;
  /** AAAAMM. */
  readonly competencia: string;
  readonly profissionais: readonly ProfissionalParaExportacaoCnes[];
}

export interface PendenciaExportacaoCnes {
  /** Posição do profissional na lista lida (1 em diante). */
  readonly sequencia: number;
  readonly nome: string;
  readonly motivos: readonly string[];
}

export type ResultadoExportacaoCnes =
  | {
      readonly ok: true;
      readonly xml: string;
      readonly nomeArquivo: string;
      readonly exportados: number;
      readonly pendencias: readonly PendenciaExportacaoCnes[];
    }
  | { readonly ok: false; readonly motivo: string; readonly pendencias: readonly PendenciaExportacaoCnes[] };

const digitos = (v: string | null): string => (v ?? '').replace(/\D/g, '');
const esc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Os motivos que impedem o profissional de entrar no arquivo (vazio: entra). */
export function criticarProfissionalCnes(p: ProfissionalParaExportacaoCnes): string[] {
  const m: string[] = [];
  if (!p.nome.trim()) m.push('Sem nome.');
  if (!cpfValido(digitos(p.cpf))) m.push('CPF ausente ou inválido.');
  if (p.cns !== null && p.cns.trim() !== '' && !cnsValido(digitos(p.cns)))
    m.push('Cartão de saúde inválido.');
  if (!/^\d{6}$/.test(digitos(p.cbo))) m.push('Sem ocupação (CBO) de 6 dígitos.');
  if (!p.vinculo) m.push('Sem vínculo de trabalho do cadastro nacional.');
  const total = p.cargaAmbulatorial + p.cargaHospitalar + p.cargaOutros;
  if (total <= 0) m.push('Sem carga horária semanal.');
  if (total > 168) m.push('Carga horária semanal acima de 168 horas.');
  return m;
}

/** Gera o arquivo dos profissionais da competência; quem tem pendência fica fora e é listado. */
export function montarExportacaoProfissionaisCnes(e: EntradaExportacaoCnes): ResultadoExportacaoCnes {
  const cnes = digitos(e.codigoCnes);
  if (cnes.length !== 7)
    return { ok: false, motivo: 'O estabelecimento não tem CNES de 7 dígitos.', pendencias: [] };
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(e.competencia))
    return { ok: false, motivo: 'Competência inválida (AAAAMM).', pendencias: [] };
  const pendencias: PendenciaExportacaoCnes[] = [];
  const linhas: string[] = [];
  e.profissionais.forEach((p, i) => {
    const motivos = criticarProfissionalCnes(p);
    if (motivos.length) {
      pendencias.push({ sequencia: i + 1, nome: p.nome, motivos });
      return;
    }
    const v = p.vinculo!;
    const cons = p.conselho
      ? `\n      <conselho sigla="${esc(p.conselho.sigla)}" uf="${esc(p.conselho.uf)}" numero="${esc(p.conselho.numero)}"/>`
      : '';
    linhas.push(
      `  <profissional>\n    <cpf>${digitos(p.cpf)}</cpf>\n` +
        (digitos(p.cns) ? `    <cns>${digitos(p.cns)}</cns>\n` : '') +
        `    <nome>${esc(p.nome.trim())}</nome>\n` +
        `    <lotacao cbo="${digitos(p.cbo)}" vinculo="${esc(v.vinculo)}" tipo="${esc(v.tipo)}" subtipo="${esc(v.subtipo)}"` +
        ` cargaAmbulatorial="${p.cargaAmbulatorial}" cargaHospitalar="${p.cargaHospitalar}" cargaOutros="${p.cargaOutros}"` +
        ` atendeSus="${p.atendeSus ? 'S' : 'N'}">${cons}${cons ? '\n    ' : ''}</lotacao>\n  </profissional>`,
    );
  });
  if (linhas.length === 0)
    return { ok: false, motivo: 'Nenhum profissional sem pendência para exportar.', pendencias };
  const cnpj = digitos(e.cnpj);
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<profissionaisCadastroNacional leiaute="${LEIAUTE_EXPORTACAO_CNES.versao}" cnes="${cnes}"` +
    `${cnpj ? ` cnpj="${cnpj}"` : ''} competencia="${e.competencia}" quantidade="${linhas.length}">\n` +
    linhas.join('\n') +
    '\n</profissionaisCadastroNacional>\n';
  return {
    ok: true,
    xml,
    nomeArquivo: `profissionais-cnes-${cnes}-${e.competencia}.xml`,
    exportados: linhas.length,
    pendencias,
  };
}
