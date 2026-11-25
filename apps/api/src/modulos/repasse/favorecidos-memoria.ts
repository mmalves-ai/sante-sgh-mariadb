// Favorecidos do repasse e prestadores terceiros em memória (F3.7, 06-FAT linha 46): a porta da fonte sintética (E2E e
// desenvolvimento sem banco do cliente). As regras são as mesmas da porta própria (@sgh/dominio-repasse): o anterior do
// mesmo tipo e fonte termina no dia de antes, a soma por fonte não passa de 100%, encerrar só antecipa o fim, o
// enquadramento novo de um tributo termina o anterior; nada é apagado. Massa sintética, sem dado de pessoa.
import {
  donoDaConta,
  type EnquadramentoDoFornecedor,
  planejarEnquadramento,
  planejarFavorecido,
  retencoesDoFavorecido,
  type TipoFavorecido,
  validarEncerramento,
  validarFavorecido,
  validarPrestadorTerceiro,
} from '@sgh/dominio-repasse';
import { ErroOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  recusaRegra,
} from '../../porta-estabelecimento-propria.js';
import {
  esquemaEnquadramento,
  esquemaFavorecido,
  esquemaPrestador,
  type FavorecidoRepasse,
  type PortaFavorecidosRepasse,
  type PrestadorTerceiro,
} from './favorecidos-propria.js';

type Credor = { tipo: TipoFavorecido | 'prestador_terceiro'; id: number };
interface Conta {
  id: number;
  credor: Credor;
  rotulo: string;
  titular: string;
  documentoFinal: string;
  preferencial: boolean;
}
type Favorecido = Omit<FavorecidoRepasse, 'retencoes'>;

const PROFISSIONAIS = [
  { id: 1, nome: 'MEDICA SINTETICA ALFA', documento: null },
  { id: 2, nome: 'MEDICO SINTETICO BETA', documento: null },
];
const EMPRESAS = [
  { id: 11, nome: 'CLINICA SINTETICA ALFA LTDA', documento: '37110492000188', fornecedor: 21 },
];
const COOPERATIVAS = [{ id: 31, nome: 'COOPERATIVA SINTETICA', documento: '11222333000181', fornecedor: 22 }];
const FONTES = [
  { id: 41, nome: 'OPERADORA SINTETICA A', documento: null },
  { id: 42, nome: 'OPERADORA SINTETICA B', documento: null },
];
const TRIBUTOS = [
  { id: 51, codigo: 'ISS', descricao: 'Imposto sobre serviços' },
  { id: 52, codigo: 'IRRF', descricao: 'Imposto de renda retido na fonte' },
];

const hoje = () => new Date().toISOString().slice(0, 10);

export class PortaFavorecidosRepasseMemoria implements PortaFavorecidosRepasse {
  private seq = 1000;
  private readonly favorecidos: Favorecido[] = [];
  private readonly prestadores: PrestadorTerceiro[] = [];
  private readonly enquadramentos: (EnquadramentoDoFornecedor & { id: number; fornecedor: number })[] = [];
  private readonly contas: Conta[] = [
    {
      id: 61,
      credor: { tipo: 'proprio_profissional', id: 1 },
      rotulo: 'PIX (email)',
      titular: 'MEDICA SINTETICA ALFA',
      documentoFinal: '0191',
      preferencial: true,
    },
    {
      id: 62,
      credor: { tipo: 'pessoa_juridica', id: 11 },
      rotulo: 'Ag. 0001 / conta 12345',
      titular: 'CLINICA SINTETICA ALFA LTDA',
      documentoFinal: '0188',
      preferencial: true,
    },
  ];

  private nomeDoAlvo(
    f: Pick<Favorecido, 'tipo' | 'pessoaJuridica' | 'cooperativa' | 'terceiroProfissional'>,
  ) {
    if (f.tipo === 'pessoa_juridica') return EMPRESAS.find((x) => x.id === f.pessoaJuridica)?.nome ?? null;
    if (f.tipo === 'cooperativa') return COOPERATIVAS.find((x) => x.id === f.cooperativa)?.nome ?? null;
    if (f.tipo === 'terceiro_profissional')
      return PROFISSIONAIS.find((x) => x.id === f.terceiroProfissional)?.nome ?? null;
    return null;
  }

  private fornecedorDe(f: Pick<Favorecido, 'tipo' | 'pessoaJuridica' | 'cooperativa'>): number | null {
    if (f.tipo === 'pessoa_juridica')
      return EMPRESAS.find((x) => x.id === f.pessoaJuridica)?.fornecedor ?? null;
    if (f.tipo === 'cooperativa') return COOPERATIVAS.find((x) => x.id === f.cooperativa)?.fornecedor ?? null;
    return null;
  }

  async listarFavorecidos(
    _c: ContextoPortaPropria,
    profissional: number | null,
  ): Promise<FavorecidoRepasse[]> {
    const dia = hoje();
    return this.favorecidos
      .filter((f) => profissional === null || f.profissional === profissional)
      .sort((a, b) => b.inicio.localeCompare(a.inicio) || b.id - a.id)
      .map((f) => ({
        ...f,
        retencoes: retencoesDoFavorecido(
          f.tipo,
          f.fornecedor,
          this.enquadramentos.filter((e) => e.fornecedor === f.fornecedor),
          dia,
        ),
      }));
  }

  async listarAlvos(
    _c: ContextoPortaPropria,
    tipo: 'pessoa_juridica' | 'cooperativa' | 'terceiro_profissional' | 'fonte_pagadora',
    busca: string,
  ): Promise<{ id: number; nome: string; documento: string | null }[]> {
    const lista = {
      pessoa_juridica: EMPRESAS,
      cooperativa: COOPERATIVAS,
      terceiro_profissional: PROFISSIONAIS,
      fonte_pagadora: FONTES,
    }[tipo];
    const b = busca.trim().toUpperCase();
    return lista
      .filter((x) => !b || x.nome.includes(b))
      .map((x) => ({ id: x.id, nome: x.nome, documento: x.documento }));
  }

  async listarContas(_c: ContextoPortaPropria, credor: Credor) {
    // a conta é do credor do tipo (donoDaConta), como na porta própria
    const tipo: Credor['tipo'] =
      credor.tipo === 'terceiro_profissional' ? 'proprio_profissional' : credor.tipo;
    return this.contas
      .filter((x) => x.credor.tipo === tipo && x.credor.id === credor.id)
      .map((x) => ({
        id: x.id,
        rotulo: x.rotulo,
        titular: x.titular,
        documentoFinal: x.documentoFinal,
        preferencial: x.preferencial,
      }));
  }

  async incluirFavorecido(
    _c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ id: number; encerrados: number[] }> {
    const e = entradaValida(esquemaFavorecido, entrada);
    const forma = validarFavorecido(e);
    if (forma.length) throw recusaRegra('Favorecido recusado', forma);
    if (!PROFISSIONAIS.some((x) => x.id === e.profissional)) throw naoEncontrado('Profissional');
    if (e.fontePagadora !== null && !FONTES.some((x) => x.id === e.fontePagadora))
      throw naoEncontrado('Fonte pagadora');
    if (e.contaBancaria !== null) {
      const conta = this.contas.find((x) => x.id === e.contaBancaria);
      if (!conta) throw naoEncontrado('Conta de crédito');
      const dono = donoDaConta(e.tipo);
      const esperado: Credor =
        dono === 'fornecedor_da_empresa'
          ? { tipo: 'pessoa_juridica', id: e.pessoaJuridica ?? 0 }
          : dono === 'fornecedor_da_cooperativa'
            ? { tipo: 'cooperativa', id: e.cooperativa ?? 0 }
            : {
                tipo: 'proprio_profissional',
                id: dono === 'terceiro_profissional' ? (e.terceiroProfissional ?? 0) : e.profissional,
              };
      if (conta.credor.tipo !== esperado.tipo || conta.credor.id !== esperado.id)
        throw recusaRegra('Favorecido recusado', [
          { campo: 'contaBancaria', mensagem: 'A conta de crédito não é do favorecido.' },
        ]);
    }
    const doProf = this.favorecidos.filter((f) => f.profissional === e.profissional && f.ativo);
    const plano = planejarFavorecido(e, doProf);
    if (plano.problemas.length) throw recusaRegra('Favorecido recusado', plano.problemas);
    for (const enc of plano.encerrar) {
      const f = this.favorecidos.find((x) => x.id === enc.id)!;
      f.fim = enc.fim;
      f.versao += 1;
    }
    const novo: Favorecido = {
      id: ++this.seq,
      profissional: e.profissional,
      profissionalNome: PROFISSIONAIS.find((x) => x.id === e.profissional)!.nome,
      fontePagadora: e.fontePagadora,
      fontePagadoraNome: FONTES.find((x) => x.id === e.fontePagadora)?.nome ?? null,
      tipo: e.tipo,
      pessoaJuridica: e.pessoaJuridica,
      cooperativa: e.cooperativa,
      terceiroProfissional: e.terceiroProfissional,
      alvoNome: this.nomeDoAlvo(e),
      contaBancaria: e.contaBancaria,
      percentual: e.percentual,
      inicio: e.inicio,
      fim: e.fim,
      ativo: true,
      versao: 1,
      fornecedor: this.fornecedorDe(e),
    };
    this.favorecidos.push(novo);
    return { id: novo.id, encerrados: plano.encerrar.map((x) => x.id) };
  }

  async encerrarFavorecido(_c: ContextoPortaPropria, favorecido: number, entrada: unknown) {
    const x = entradaValida(
      z
        .object({ versao: z.number().int().positive(), fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
        .strict(),
      entrada,
    );
    const f = this.favorecidos.find((v) => v.id === favorecido);
    if (!f) throw naoEncontrado('Favorecido');
    if (f.versao !== x.versao)
      throw new ErroOperacao(409, 'conflito-versao', 'Registro alterado', 'Recarregue e tente de novo.');
    const problemas = validarEncerramento(f, x.fim);
    if (problemas.length) throw recusaRegra('Encerramento recusado', problemas);
    f.fim = x.fim;
    f.versao += 1;
    return { id: f.id };
  }

  async listarTributos() {
    return TRIBUTOS.map((t) => ({ ...t }));
  }

  async incluirEnquadramento(_c: ContextoPortaPropria, fornecedor: number, entrada: unknown) {
    const x = entradaValida(esquemaEnquadramento, entrada);
    if (![...EMPRESAS, ...COOPERATIVAS].some((e) => e.fornecedor === fornecedor))
      throw naoEncontrado('Fornecedor');
    if (x.tributo !== null && !TRIBUTOS.some((t) => t.id === x.tributo)) throw naoEncontrado('Tributo');
    const doFornecedor = this.enquadramentos.filter((e) => e.fornecedor === fornecedor);
    const plano = planejarEnquadramento(
      x,
      doFornecedor.map((e) => ({ id: e.id, tributo: e.tributo, inicio: e.inicio, fim: e.fim })),
    );
    if (plano.problemas.length) throw recusaRegra('Enquadramento recusado', plano.problemas);
    for (const enc of plano.encerrar) {
      const i = this.enquadramentos.findIndex((e) => e.id === enc.id);
      this.enquadramentos[i] = { ...this.enquadramentos[i]!, fim: enc.fim };
    }
    const id = ++this.seq;
    this.enquadramentos.push({
      id,
      fornecedor,
      tributo: x.tributo,
      regime: x.regime,
      retem: x.retem,
      aliquotaIss: x.aliquotaIss,
      inicio: x.inicio,
      fim: x.fim,
    });
    return { id, encerrados: plano.encerrar.map((e) => e.id) };
  }

  async listarPrestadores(_c: ContextoPortaPropria, busca: string | null): Promise<PrestadorTerceiro[]> {
    const b = (busca ?? '').trim().toUpperCase();
    return this.prestadores
      .filter((p) => !b || p.nome.toUpperCase().includes(b) || p.codigo.toUpperCase().includes(b))
      .sort((a, b2) => Number(b2.ativo) - Number(a.ativo) || a.nome.localeCompare(b2.nome))
      .map((p) => ({ ...p }));
  }

  async incluirPrestador(_c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaPrestador, entrada);
    const problemas = validarPrestadorTerceiro(x);
    if (problemas.length) throw recusaRegra('Prestador recusado', problemas);
    if (
      this.prestadores.some(
        (p) => p.codigo === x.codigo || (x.cpf && p.cpf === x.cpf) || (x.cnpj && p.cnpj === x.cnpj),
      )
    )
      throw new ErroOperacao(409, 'duplicado', 'Prestador repetido', 'Código, CPF ou CNPJ já cadastrado.');
    const id = ++this.seq;
    this.prestadores.push({
      id,
      codigo: x.codigo,
      nome: x.nome,
      nomeCurto: x.nomeCurto,
      tipoPessoa: x.tipoPessoa,
      cpf: x.cpf,
      cnpj: x.cnpj,
      cnes: x.cnes,
      profissional: x.profissional,
      cooperativa: x.cooperativa,
      percentualRepasse: x.percentualRepasse,
      baseRepasse: x.baseRepasse,
      geraCusto: x.geraCusto,
      anestesista: x.anestesista,
      aceitaCessaoCredito: x.aceitaCessaoCredito,
      email: x.email,
      telefone: x.telefone,
      ativo: true,
      inativadoEm: null,
      versao: 1,
      fornecedor: null,
    });
    return { id };
  }

  async alterarPrestador(_c: ContextoPortaPropria, prestador: number, entrada: unknown) {
    const x = entradaValida(
      z
        .object({
          versao: z.number().int().positive(),
          ativo: z.boolean().optional(),
          percentualRepasse: z.number().min(0).max(100).nullable().optional(),
          baseRepasse: z.enum(['cobrado', 'recebido', 'misto']).optional(),
          email: z.string().trim().max(254).nullable().optional(),
          telefone: z.string().trim().max(20).nullable().optional(),
        })
        .strict(),
      entrada,
    );
    const p = this.prestadores.find((v) => v.id === prestador);
    if (!p) throw naoEncontrado('Prestador');
    if (p.versao !== x.versao)
      throw new ErroOperacao(409, 'conflito-versao', 'Registro alterado', 'Recarregue e tente de novo.');
    const mud: Partial<PrestadorTerceiro> = { ...x };
    delete mud.versao;
    Object.assign(p, mud, { versao: p.versao + 1 });
    if (x.ativo === false) p.inativadoEm = hoje();
    return { id: p.id };
  }

  async incluirContaPrestador(_c: ContextoPortaPropria, prestador: number, entrada: unknown) {
    const x = entradaValida(
      z
        .object({
          banco: z.number().int().positive().nullable().default(null),
          agencia: z.string().trim().max(10).nullable().default(null),
          conta: z.string().trim().max(20).nullable().default(null),
          tipoConta: z.enum(['corrente', 'poupanca', 'pagamento', 'salario']).default('corrente'),
          tipoChavePix: z.enum(['cpf', 'cnpj', 'email', 'telefone', 'aleatoria']).nullable().default(null),
          chavePix: z.string().trim().min(1).max(77).nullable().default(null),
          preferencial: z.boolean().default(false),
        })
        .strict(),
      entrada,
    );
    if (!((x.banco !== null && x.conta) || x.chavePix))
      throw recusaRegra('Conta recusada', [
        { campo: 'conta', mensagem: 'Informe o banco e a conta, ou a chave PIX.' },
      ]);
    const p = this.prestadores.find((v) => v.id === prestador);
    if (!p) throw naoEncontrado('Prestador');
    const id = ++this.seq;
    this.contas.push({
      id,
      credor: { tipo: 'prestador_terceiro', id: prestador },
      rotulo: x.conta ? `Ag. ${x.agencia ?? '-'} / conta ${x.conta}` : `PIX (${x.tipoChavePix ?? ''})`,
      titular: p.nome,
      documentoFinal: (p.cnpj ?? p.cpf ?? '').slice(-4),
      preferencial: x.preferencial,
    });
    return { id };
  }
}
