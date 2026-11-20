// Partida comum dos testes de integração da fatia F1 da operadora (M56.2) na cópia: o núcleo só sob a trava da cópia
// (o flock do com-copia.sh, provado em /proc/locks), AMBIENTE=dev e loopback; o serviço da F1 inteiro sobre UMA
// transação da cópia SEMPRE desfeita (`desfazendoNaCopia`): a porta do legado recebe um núcleo cuja leitura e gravação
// usam a mesma transação, então o que o serviço grava ele mesmo lê, e nada fica. As chaves da operadora vêm de uma
// fonte de configuração falsa (ligadas só no teste); o estado delas na cópia não importa (M61: a liberação full as liga). Dados SINTÉTICOS.
import { resolve } from 'node:path';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  type ChaveGravada,
  type Escritor,
  lerCodigos,
  lerConfiguracaoNucleo,
  lerEstabelecimentos,
  NucleoLegado,
  PORTAS_OCUPADAS,
  type PrerequisitoGravado,
  travaDaCopiaSegura,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { FonteConfiguracao } from '../../config/public-api.js';
import { ServicoBeneficiariosOperadora } from '../aplicacao/beneficiarios.js';
import { ServicoSituacaoOperadora } from '../aplicacao/situacao.js';
import { portaOperadoraLegado } from '../porta-legado.js';
import type { PortaOperadora } from '../porta.js';

const raiz = resolve(import.meta.dirname, '../../../../../..');
export const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const codigos = lerCodigos(env);
export const PODE = codigos.length > 0 && travaDaCopiaSegura(process.pid);
export const COD = codigos[0] as string;
export const USUARIO = 'SGH.INT.M56';

export function criarNucleo(): NucleoLegado {
  if ((env['AMBIENTE']?.trim() || 'dev') !== 'dev') throw new Error('Integração só em AMBIENTE=dev.');
  for (const x of lerEstabelecimentos(env))
    if (!['127.0.0.1', 'localhost', '::1'].includes(x.host) || PORTAS_OCUPADAS.includes(x.porta))
      throw new Error(`${x.codigo}: só a cópia do projeto em loopback.`);
  return new NucleoLegado({
    env: { ...env, FB_POOL_TETO: '2' },
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
}

const chave = (c: string): ChaveGravada => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'integração sintética',
  alteradoPor: USUARIO,
  alteradoEm: '2026-10-24T10:00:00',
});
const registro: PrerequisitoGravado = {
  recurso: 'operadora',
  tipo: 'credenciamento',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'registro sintético',
  alteradoPor: USUARIO,
  alteradoEm: '2026-10-24T10:00:00',
};
const fonteLigada = {
  chaves: async () => [chave('operadora'), chave('operadora.beneficiarios')],
  prerequisitos: async () => [registro],
} as unknown as FonteConfiguracao;

/** A porta do legado e o serviço da F1 sobre a transação `e` (leitura e gravação na mesma, desfeita no fim). */
export function servicoNaTransacao(e: Escritor): {
  porta: PortaOperadora;
  servico: ServicoBeneficiariosOperadora;
} {
  const porta = portaOperadoraLegado({
    lerSomente: ((_c: unknown, fn: (l: Escritor) => Promise<unknown>) => fn(e)) as NucleoLegado['lerSomente'],
    gravarSgh: ((_c: unknown, fn: (l: Escritor) => Promise<unknown>) => fn(e)) as NucleoLegado['gravarSgh'],
  });
  return {
    porta,
    servico: new ServicoBeneficiariosOperadora(porta, new ServicoSituacaoOperadora(fonteLigada, null)),
  };
}

/** Sessão mínima do serviço (o gestor da operadora no estabelecimento da cópia). */
export function sessao(rede: string, permissoes: readonly string[] | 'todas' = 'todas'): SessaoCadastro {
  const req = {
    headers: {},
    ip: '127.0.0.1',
    sgh: { sessao: { unidadeAtiva: null } },
  } as unknown as RequisicaoAutorizada;
  return {
    req,
    hospital: COD,
    rede,
    login: USUARIO,
    porta: { rede, hospital: COD },
    pode: (c) => permissoes === 'todas' || permissoes.includes(c),
  };
}

/** O código da recusa (ErroProblema ou do banco) ou 'gravou'. */
export async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (x) {
    const e = x as { extras?: { codigo?: string }; problema?: { codigo?: string }; getStatus?: () => number };
    return e.extras?.codigo ?? e.problema?.codigo ?? String(e.getStatus?.() ?? x);
  }
}

const PRECOS = [100, 120, 130, 140, 150, 170, 200, 240, 300, 400];

/** Operadora, plano individual, contrato de pessoa física, titular e dependente SINTÉTICOS (na transação do teste). */
export async function montarCarteira(
  servico: ServicoBeneficiariosOperadora,
  s: SessaoCadastro,
  n: {
    registro: string;
    base: string;
    pacienteHospital?: number | null;
    /** M56.3: o dia de vencimento do contrato (a cobrança gera a mensalidade). */
    diaVencimento?: number | null;
  },
) {
  const { cnpjSintetico, cpfSintetico } = await import('@sgh/dominio-operadora');
  const ope = await servico.gravarOperadora(s, null, {
    registroAns: n.registro,
    cnpj: cnpjSintetico(`${n.base}0001`.padStart(12, '9').slice(-12)),
    razaoSocial: `Operadora Sintética ${n.registro}`,
    nomeFantasia: null,
    modalidade: 'medicinaGrupo',
    situacao: 'ativa',
  });
  const prod = await servico.gravarProduto(s, null, {
    operadora: ope.id,
    codigo: `INT-${n.registro}`,
    nome: 'Plano sintético da integração',
    natureza: 'plano',
    registroAns: `9${n.registro}01`.slice(0, 9).padEnd(9, '0'),
    tipoContratacao: 1,
    segmentacao: 'ambulatorialHospitalar',
    abrangencia: 'estadual',
    acomodacao: 2,
    coparticipacao: { tipo: 2, valor: 30 },
    carencias: { urgencia: 1, partos: 300, demais: 180, cpt: 24 },
    precos: PRECOS,
    situacao: 'ativo',
  });
  const ctr = await servico.gravarContrato(s, null, {
    produto: prod.id,
    numero: `INT-${n.registro}-1`,
    tipo: 1,
    contratanteNome: 'Contratante Sintético da Integração',
    contratanteDocumento: cpfSintetico(`${n.base}1`.slice(-9).padStart(9, '9')),
    formaReajuste: 1,
    mesReajuste: 5,
    tipoVigencia: 2,
    inicio: '2026-01-01',
    fim: null,
    diaVencimento: n.diaVencimento ?? null,
    situacao: 'ativo',
    motivoSituacao: null,
  });
  const tit = await servico.gravarBeneficiario(s, null, {
    contrato: ctr.id,
    titular: null,
    vinculo: 1,
    nome: 'Titular Sintética da Integração',
    nomeSocial: null,
    cpf: cpfSintetico(`${n.base}2`.slice(-9).padStart(9, '9')),
    nascimento: '1980-05-10',
    sexo: 'F',
    cns: null,
    nomeMae: 'Mãe Sintética',
    inclusao: '2026-02-01',
    pacienteHospital: n.pacienteHospital ?? null,
  });
  const dep = await servico.gravarBeneficiario(s, null, {
    contrato: ctr.id,
    titular: tit.id,
    vinculo: 5,
    nome: 'Dependente Sintético da Integração',
    nomeSocial: null,
    cpf: null,
    nascimento: '2015-03-01',
    sexo: 'M',
    cns: null,
    nomeMae: 'Titular Sintética da Integração',
    inclusao: '2026-02-01',
    pacienteHospital: null,
  });
  return { operadora: ope.id, produto: prod.id, contrato: ctr.id, titular: tit, dependente: dep.id };
}
