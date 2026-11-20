// W1-01 (parte 12b; pacote W1-01, mercado m): a matriz SBIS S-RES NGS1/NGS2 requisito a requisito. Cada requisito
// do Manual de Certificação S-RES v5.2 que a referência interna detalha (planejamento/referencias/06-normas-
// regulatorias.md §2.1.1 e §2.1.2) aponta o grupo do catálogo `REQUISITOS_SBIS` que o atende e os arquivos de
// evidência (os testes da linha do grupo em `MATRIZ_SBIS` mais os específicos do requisito) ou fica marcado como
// LACUNA com o motivo. O `pnpm sbis:verificar` gera dist/sbis/matriz-ngs.{md,json} e falha se um requisito não tem
// evidência nem lacuna, se cita grupo que a matriz não tem ou arquivo que não está versionado.
import type { LinhaMatrizSbis } from './sbis-matriz.ts';

export interface RequisitoNgs {
  /** Código do manual (NGS1.02.03) ou da seção quando a referência não numera os itens (NGS1.08). */
  readonly codigo: string;
  readonly titulo: string;
  /** O grupo do catálogo `REQUISITOS_SBIS` que atende o requisito (null = nenhum: lacuna). */
  readonly grupo: string | null;
  /** Evidências próprias do requisito, além dos testes do grupo (caminho a partir da raiz). */
  readonly evidencias?: readonly string[];
  /** Motivo da lacuna (obrigatório quando não há grupo). */
  readonly lacuna?: string;
}

const SEM_TEXTO =
  'texto do requisito não consta da referência interna (06-normas-regulatorias §2.1); conferir no Manual S-RES v5.2 ' +
  'e mapear ao catálogo antes da auditoria';

const N = (
  codigo: string,
  titulo: string,
  grupo: string | null,
  evidencias: readonly string[] = [],
  lacuna?: string,
): RequisitoNgs => ({ codigo, titulo, grupo, evidencias, ...(lacuna ? { lacuna } : {}) });

const faixa = (
  prefixo: string,
  de: number,
  ate: number,
  titulo: string,
  grupo: string | null,
  evidencias: readonly string[] = [],
  lacuna?: string,
): RequisitoNgs[] =>
  Array.from({ length: ate - de + 1 }, (_, i) =>
    N(`${prefixo}.${String(de + i).padStart(2, '0')}`, titulo, grupo, evidencias, lacuna),
  );

// Evidências do W1-01 (acesso: senha, usuário, política, termo, sessões).
const POLITICA = [
  'packages/dominio-acesso/src/politica-senha-sante.spec.ts',
  'packages/legado/src/acesso/gravacao/politica-senha-sgh.spec.ts',
];
const CICLO = [
  'apps/api/src/sessao/troca-senha.spec.ts',
  'apps/api/src/sessao/redefinir-senha.spec.ts',
  'apps/api/src/sessao/recuperacao-senha.spec.ts',
  'packages/legado/src/acesso/gravacao/senha.spec.ts',
];
const SESSOES = [
  'apps/api/src/sessao/minhas-sessoes.spec.ts',
  'packages/legado/src/acesso/gravacao/limite-sessao-sgh.spec.ts',
];
const IDENTIDADE = [
  'apps/api/src/modulos/administracao/usuarios-cpf.spec.ts',
  'packages/dominio-acesso/src/usuario/painel-cpf.spec.ts',
  'packages/legado/src/acesso/dependencias-acesso.spec.ts',
];
const INATIVACAO = [
  'packages/legado/src/acesso/gravacao/flags-usuario.spec.ts',
  'packages/dominio-acesso/src/usuario/contas-dormentes.spec.ts',
  'apps/api/src/modulos/acesso/recertificacao.controller.spec.ts',
  'apps/api/src/modulos/acesso/pedido-acesso.controller.spec.ts',
];

/** Os requisitos NGS1 e NGS2, item a item (faixas da referência expandidas). */
export const REQUISITOS_NGS: readonly RequisitoNgs[] = [
  // NGS1: segurança
  N('NGS1.01.01', 'Versão do software', 'SBIS-01'),
  N('NGS1.02.01', 'Método de autenticação validado no servidor', 'SBIS-02'),
  N('NGS1.02.02', 'Proteção de credenciais: hash com salt individual', 'SBIS-03', [
    'packages/legado/src/acesso/gravacao/senha.spec.ts',
  ]),
  ...faixa('NGS1.02', 3, 5, 'Qualidade de senha parametrizável', 'SBIS-04', POLITICA),
  ...faixa(
    'NGS1.02',
    6,
    12,
    'Ciclo da senha (provisória, troca forçada, expiração, reuso, envio)',
    'SBIS-04',
    [...POLITICA, ...CICLO],
  ),
  N('NGS1.02.13', 'Bloqueio após N tentativas (N ≤ 10)', 'SBIS-05'),
  N('NGS1.02.14', 'Reautenticação em operação crítica', 'SBIS-07'),
  N('NGS1.02.15', 'Desbloqueio pelo administrador ou por fluxo seguro', 'SBIS-05', [
    'apps/api/src/sessao/recuperacao-senha.spec.ts',
  ]),
  N('NGS1.02.16', 'Mensagem de erro genérica', 'SBIS-05', ['apps/api/src/sessao/recuperacao-senha.spec.ts']),
  N('NGS1.02.17', 'Última autenticação válida e falhas mostradas ao entrar', 'SBIS-06'),
  N('NGS1.02.18', 'Dois métodos de autenticação (2FA)', 'SBIS-08'),
  N('NGS1.02.19', 'Proteção de templates biométricos e sementes OTP', 'SBIS-03'),
  ...faixa(
    'NGS1.02',
    20,
    23,
    'Sessão: bloqueio por inatividade, aviso, volta sem perder o digitado',
    'SBIS-09',
    SESSOES,
  ),
  N('NGS1.03.01', 'Controle de acesso por perfil (RBAC)', 'SBIS-10'),
  N('NGS1.03.02', 'Perfis mínimos; administrativo sem acesso clínico', 'SBIS-10'),
  ...faixa('NGS1.03', 3, 6, '(não detalhado na referência)', null, [], SEM_TEXTO),
  N('NGS1.03.07', 'Vários perfis por usuário', 'SBIS-10', [
    'apps/api/src/modulos/acesso/pedido-acesso.controller.spec.ts',
  ]),
  N('NGS1.03.08', 'Inativação de usuário sem exclusão', 'SBIS-10', INATIVACAO),
  N(
    'NGS1.03.09',
    'Identidade única: CPF único, troca justificada, sem exclusão de quem operou',
    'SBIS-11',
    IDENTIDADE,
  ),
  N('NGS1.03.10', 'Administrador mínimo ativo e não removível', 'SBIS-12', [
    'packages/dominio-acesso/src/usuario/ultimo-gestor.spec.ts',
    'apps/api/src/modulos/acesso/ultimo-gestor.spec.ts',
  ]),
  ...faixa('NGS1.04', 1, 6, 'Backup cifrado, verificado e com restauração atômica', 'SBIS-13'),
  ...faixa(
    'NGS1.05',
    1,
    4,
    'Comunicação segura (TLS, canal autenticado, processamento no servidor)',
    'SBIS-14',
  ),
  ...faixa('NGS1.06', 1, 5, 'Dados no SGBD; anexos cifrados com nome opaco; temporários apagados', 'SBIS-15'),
  ...faixa('NGS1.07', 1, 2, 'Auditoria contínua e protegida', 'SBIS-16'),
  ...faixa('NGS1.07', 3, 4, 'Eventos auditáveis mínimos', 'SBIS-17'),
  ...faixa('NGS1.07', 5, 6, 'Conteúdo do registro de auditoria, sem dado sensível', 'SBIS-18', [
    'apps/api/src/sessao/recuperacao-senha.spec.ts',
    'packages/legado/src/acesso/gravacao/politica-senha-sgh.spec.ts',
  ]),
  ...faixa('NGS1.07', 7, 8, 'Consulta e exportação da trilha', 'SBIS-19'),
  N('NGS1.08', 'Documentação (numeração dos itens a conferir no manual)', 'SBIS-20'),
  ...faixa('NGS1.09', 1, 6, 'Tempo: NTP, milissegundos, fuso, RFC 3339', 'SBIS-21'),
  N('NGS1.10.01', 'Notificação de ocorrências pelo usuário', 'SBIS-22'),
  N('NGS1.11.01', 'Termo de uso no primeiro acesso e a cada nova versão', 'SBIS-23', [
    'apps/api/src/modulos/administracao/termo-publicar.spec.ts',
  ]),
  ...faixa('NGS1.11', 2, 7, '(não detalhado na referência)', null, [], SEM_TEXTO),
  N('NGS1.11.08', 'Contestação do paciente', 'SBIS-24'),
  ...faixa('NGS1.11', 9, 10, '(não detalhado na referência)', null, [], SEM_TEXTO),
  ...faixa('NGS1.11', 11, 12, 'Anonimização e pseudonimização', 'SBIS-25'),
  N('NGS1.12.01', 'Integridade: correção por nova versão com justificativa', 'SBIS-26'),
  N('NGS1.12.02', '(não detalhado na referência)', null, [], SEM_TEXTO),
  N('NGS1.12.03', 'Inativação com justificativa, versão anterior visível', 'SBIS-26'),
  // NGS2: certificação digital
  N('NGS2.01.01', 'ICP-Brasil com certificado A1/A3 e em nuvem', 'SBIS-30'),
  N('NGS2.01.02', 'CPF do certificado igual ao do usuário', 'SBIS-31'),
  ...faixa('NGS2.01', 3, 4, 'Validação no servidor: cadeia, vigência e revogação', 'SBIS-32'),
  N('NGS2.01.05', 'Pelo menos duas ACs de 1º nível por mídia', 'SBIS-30'),
  N('NGS2.02.01', 'Formato CAdES, XAdES ou PAdES', 'SBIS-33'),
  N(
    'NGS2.02.02',
    'Propósito do certificado (digitalSignature + nonRepudiation; A1–A4)',
    null,
    [],
    'o catálogo não tem o grupo SBIS-34 nem linha na matriz de rastreabilidade',
  ),
  N('NGS2.02.03', 'Política mínima AD-RB e instante da assinatura', 'SBIS-33'),
  N('NGS2.02.04', 'O que você vê é o que você assina', 'SBIS-35'),
  ...faixa('NGS2.02', 5, 6, 'Pendências de assinatura e assinatura em lote', 'SBIS-36'),
  N('NGS2.02.07', '(não detalhado na referência)', null, [], SEM_TEXTO),
  N('NGS2.02.08', 'Serviço externo fora do ar', 'SBIS-37'),
  ...faixa('NGS2.02', 9, 11, 'Selo de assinado e encadeamento verificável', 'SBIS-38'),
  ...faixa('NGS2.03', 1, 4, 'Validação das assinaturas', 'SBIS-39'),
  ...faixa('NGS2.04', 1, 5, 'Carimbo do tempo AD-RT por ACT credenciada', 'SBIS-40'),
  N(
    'NGS2.05',
    'Certificado de atributo (opcional)',
    null,
    [],
    'opcional no manual; o catálogo não tem o grupo SBIS-41 (decisão de produto pendente)',
  ),
  ...faixa('NGS2.06', 1, 7, 'Importação, exportação e impressão de documentos assinados', 'SBIS-42'),
  N('NGS2.07.01', 'Login por certificado', 'SBIS-43'),
];

export interface LinhaNgs {
  readonly codigo: string;
  readonly nivel: 'NGS1' | 'NGS2';
  readonly titulo: string;
  readonly grupo: string | null;
  readonly funcionalidade: string;
  readonly evidencias: readonly string[];
  readonly situacao: 'evidencia' | 'lacuna';
  readonly lacuna: string | null;
}

const CODIGO_NGS = /^NGS[12]\.\d\d(?:\.\d\d)?$/;

/** Cruza os requisitos NGS com a matriz de rastreabilidade e o repositório. */
export function montarMatrizNgs(
  requisitos: readonly RequisitoNgs[],
  matriz: Readonly<Record<string, LinhaMatrizSbis>>,
  versionado: (arquivo: string) => boolean,
): { linhas: LinhaNgs[]; achados: { codigo: string; motivo: string }[] } {
  const achados: { codigo: string; motivo: string }[] = [];
  const vistos = new Set<string>();
  const linhas = requisitos.map((r): LinhaNgs => {
    if (!CODIGO_NGS.test(r.codigo))
      achados.push({ codigo: r.codigo, motivo: 'código fora do formato NGSn.nn.nn' });
    if (vistos.has(r.codigo)) achados.push({ codigo: r.codigo, motivo: 'requisito repetido' });
    vistos.add(r.codigo);
    const linhaGrupo = r.grupo ? matriz[r.grupo] : undefined;
    if (r.grupo && !linhaGrupo)
      achados.push({ codigo: r.codigo, motivo: `grupo sem linha na matriz: ${r.grupo}` });
    const evidencias = [...new Set([...(linhaGrupo?.testes ?? []), ...(r.evidencias ?? [])])];
    for (const a of evidencias)
      if (!versionado(a)) achados.push({ codigo: r.codigo, motivo: `evidência não versionada: ${a}` });
    const lacuna = r.lacuna?.trim() ? r.lacuna : null;
    if (evidencias.length === 0 && !lacuna)
      achados.push({ codigo: r.codigo, motivo: 'requisito sem evidência e sem lacuna marcada' });
    if (evidencias.length > 0 && lacuna)
      achados.push({ codigo: r.codigo, motivo: 'requisito com evidência e lacuna ao mesmo tempo' });
    return {
      codigo: r.codigo,
      nivel: r.codigo.startsWith('NGS2') ? 'NGS2' : 'NGS1',
      titulo: r.titulo,
      grupo: r.grupo,
      funcionalidade: linhaGrupo?.funcionalidade ?? '',
      evidencias,
      situacao: evidencias.length > 0 ? 'evidencia' : 'lacuna',
      lacuna,
    };
  });
  return { linhas, achados };
}

export function matrizNgsEmMarkdown(linhas: readonly LinhaNgs[]): string {
  const conta = (nivel: string, s: string) =>
    linhas.filter((l) => l.nivel === nivel && l.situacao === s).length;
  return [
    '# Matriz SBIS S-RES NGS1/NGS2 (requisito a requisito)',
    '',
    'Gerada por `pnpm sbis:verificar` a partir de `tools/verificadores/src/sbis-ngs.ts` e da matriz de ' +
      'rastreabilidade (`sbis-matriz.ts`).',
    `NGS1: ${conta('NGS1', 'evidencia')} com evidência, ${conta('NGS1', 'lacuna')} lacuna(s). ` +
      `NGS2: ${conta('NGS2', 'evidencia')} com evidência, ${conta('NGS2', 'lacuna')} lacuna(s).`,
    '',
    '| Requisito | Título | Grupo | Funcionalidade | Evidência ou lacuna |',
    '|---|---|---|---|---|',
    ...linhas.map(
      (l) =>
        `| ${l.codigo} | ${l.titulo} | ${l.grupo ?? '—'} | ${l.funcionalidade || '—'} | ` +
        (l.situacao === 'lacuna'
          ? `**LACUNA**: ${l.lacuna}`
          : l.evidencias.map((a) => `\`${a}\``).join('<br>')) +
        ' |',
    ),
    '',
  ].join('\n');
}
