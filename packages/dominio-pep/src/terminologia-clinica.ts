// Terminologia clínica no prontuário (F8, 09-AREA linha 84): o conceito clínico equivalente do diagnóstico, a região
// anatômica codificada e a ligação da região ao exame. Regras puras (sem banco): o que a porta própria confere antes de
// gravar no MariaDB. O diagnóstico do atendimento é sempre codificado pela CID-10 (é o que vai para a conta, a guia
// TISS e as notificações); o conceito clínico (SNOMED CT, licença nacional do Ministério da Saúde, carregado no espelho
// padrão da base) é o detalhe clínico equivalente, opcional e trocável sem apagar nada (a versão do registro sobe).

export interface FalhaTerminologia {
  readonly codigo: string;
  readonly mensagem: string;
}

/** Código da terminologia clínica no catálogo `terminologia` (carregador catalogos/carregadores/snomed.py). */
export const TERMINOLOGIA_CONCEITO_CLINICO = 'snomed';
/** Código da CID-10 no catálogo `terminologia` (carregador catalogos/carregadores/cid10.py). */
export const TERMINOLOGIA_DIAGNOSTICO = 'cid10';

export const TIPOS_DIAGNOSTICO = ['principal', 'secundario', 'admissao', 'alta', 'obito'] as const;
export type TipoDiagnostico = (typeof TIPOS_DIAGNOSTICO)[number];
export const CERTEZAS_DIAGNOSTICO = ['suspeito', 'confirmado', 'descartado'] as const;
export const ESCOPOS_DIAGNOSTICO = ['atendimento', 'prontuario'] as const;
export const NIVEIS_REGIAO = ['regiao', 'localizacao_primaria', 'localizacao', 'sublocalizacao'] as const;
export type NivelRegiao = (typeof NIVEIS_REGIAO)[number];
export const OBSERVACAO_DIAGNOSTICO_MAXIMA = 2000;

/** Termo lido do catálogo, no vocabulário neutro da porta. */
export interface TermoCatalogo {
  readonly terminologia: string;
  readonly ativo: boolean;
  /** Nível na hierarquia (CID-10: 1 capítulo, 2 agrupamento, 3 categoria, 4 subcategoria). */
  readonly nivel: number | null;
  readonly vigenciaFim: Date | null;
}

const vigente = (t: { readonly ativo: boolean; readonly vigenciaFim: Date | null }, hoje: Date) =>
  t.ativo && (t.vigenciaFim === null || t.vigenciaFim.getTime() >= inicioDoDia(hoje).getTime());

function inicioDoDia(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** O conceito clínico equivalente: da terminologia clínica, ativo e em vigor. Nulo é aceito (é opcional). */
export function validarConceitoClinico(
  conceito: TermoCatalogo | null | undefined,
  hoje: Date,
): FalhaTerminologia[] {
  if (conceito === undefined) return [];
  if (conceito === null)
    return [
      { codigo: 'conceito-inexistente', mensagem: 'O conceito clínico escolhido não existe no catálogo.' },
    ];
  if (conceito.terminologia !== TERMINOLOGIA_CONCEITO_CLINICO)
    return [
      {
        codigo: 'conceito-de-outra-terminologia',
        mensagem: 'O conceito equivalente tem de ser da terminologia clínica (SNOMED CT).',
      },
    ];
  if (!vigente(conceito, hoje))
    return [{ codigo: 'conceito-inativo', mensagem: 'O conceito clínico está inativo ou fora de vigência.' }];
  return [];
}

export interface EntradaDiagnostico {
  readonly cid: TermoCatalogo | null;
  readonly conceito?: TermoCatalogo | null;
  readonly tipo: TipoDiagnostico;
  readonly observacao?: string | null;
  /** O atendimento é do paciente informado. */
  readonly atendimentoDoPaciente: boolean;
  /** Já há diagnóstico principal ativo neste atendimento. */
  readonly principalAtivoExiste: boolean;
}

/** Regras do registro do diagnóstico do atendimento (CID-10 obrigatória, conceito clínico opcional). */
export function validarRegistroDiagnostico(e: EntradaDiagnostico, hoje: Date): FalhaTerminologia[] {
  const f: FalhaTerminologia[] = [];
  if (!e.atendimentoDoPaciente)
    f.push({ codigo: 'atendimento-de-outro-paciente', mensagem: 'O atendimento não é deste paciente.' });
  if (!e.cid) f.push({ codigo: 'cid-inexistente', mensagem: 'A CID-10 informada não existe no catálogo.' });
  else if (e.cid.terminologia !== TERMINOLOGIA_DIAGNOSTICO)
    f.push({ codigo: 'cid-de-outra-terminologia', mensagem: 'O diagnóstico é codificado pela CID-10.' });
  else if (e.cid.nivel !== null && e.cid.nivel < 3)
    f.push({
      codigo: 'cid-nao-codificavel',
      mensagem:
        'Capítulo e agrupamento da CID-10 não codificam diagnóstico: escolha a categoria ou a subcategoria.',
    });
  else if (!vigente(e.cid, hoje))
    f.push({ codigo: 'cid-inativa', mensagem: 'A CID-10 informada está inativa ou fora de vigência.' });
  f.push(...validarConceitoClinico(e.conceito, hoje));
  if (e.tipo === 'principal' && e.principalAtivoExiste)
    f.push({
      codigo: 'principal-ja-registrado',
      mensagem: 'O atendimento já tem diagnóstico principal ativo: registre este como secundário.',
    });
  if ((e.observacao ?? '').length > OBSERVACAO_DIAGNOSTICO_MAXIMA)
    f.push({
      codigo: 'observacao-longa',
      mensagem: `A observação passa de ${OBSERVACAO_DIAGNOSTICO_MAXIMA} caracteres.`,
    });
  return f;
}

/** Trocar (ou tirar) o conceito equivalente só vale em diagnóstico não inativado. */
export function validarTrocaConceito(
  diagnostico: { readonly situacao: string },
  conceito: TermoCatalogo | null | undefined,
  hoje: Date,
): FalhaTerminologia[] {
  if (diagnostico.situacao === 'inativado')
    return [
      {
        codigo: 'diagnostico-inativado',
        mensagem: 'O diagnóstico inativado fica como registrado: o conceito não muda.',
      },
    ];
  return validarConceitoClinico(conceito, hoje);
}

/** Nível da região anatômica pela profundidade abaixo da raiz "estrutura do corpo" (1 = região). */
export function nivelRegiaoPorProfundidade(profundidade: number): NivelRegiao {
  if (profundidade <= 1) return 'regiao';
  if (profundidade === 2) return 'localizacao_primaria';
  if (profundidade === 3) return 'localizacao';
  return 'sublocalizacao';
}

/** A região ligada ao exame tem de estar ativa e em vigor; a ligação repetida é recusada. */
export function validarRegiaoDoExame(
  regiao: { readonly ativo: boolean; readonly vigenciaFim: Date | null } | null,
  jaLigada: boolean,
  hoje: Date,
): FalhaTerminologia[] {
  if (!regiao)
    return [{ codigo: 'regiao-inexistente', mensagem: 'A região anatômica não existe no catálogo.' }];
  if (!vigente(regiao, hoje))
    return [{ codigo: 'regiao-inativa', mensagem: 'A região anatômica está inativa ou fora de vigência.' }];
  if (jaLigada) return [{ codigo: 'regiao-ja-ligada', mensagem: 'A região já está ligada a este exame.' }];
  return [];
}

/** Sugestões do conceito para a CID: equivalências em vigor, a principal primeiro, depois as exatas, depois o resto. */
export function ordenarSugestoesConceito<
  T extends { readonly principal: boolean; readonly tipoEquivalencia: string; readonly descricao: string },
>(lista: readonly T[]): T[] {
  const peso = (x: T) => (x.principal ? 0 : x.tipoEquivalencia === 'equivalente' ? 1 : 2);
  return [...lista].sort((a, b) => peso(a) - peso(b) || a.descricao.localeCompare(b.descricao, 'pt-BR'));
}
