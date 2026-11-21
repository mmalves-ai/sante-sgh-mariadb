// Integrações novas (M34; ficha, seção 7, regras 7 a 16): o monitor de filas com a fila de mortos e o alerta acima de
// 4 h (regra 10), o tratamento da mensagem morta com o motivo (reprocessar, corrigir, descartar; regra 9), os
// parceiros novos (cliente de integração, escopos, eventos, finalidade e base legal; o segredo sai uma vez), os que
// leem o banco (as visões existem e são contadas, nunca lidas; a oferta de canal novo na ordem da regra 16), o FHIR R4
// nos perfis BR Core fixados e a RNDS (CPF primeiro, CNS opcional, envio de vacina construído e desligado; fora de
// produção só a homologação ou o simulador), os canais HL7 v2 do motor de integração e a comunicação com o paciente,
// só pela Hal-AI (sem canal próprio; envio desligado até a base legal).
import {
  BASES_LEGAIS,
  type CredencialEmitida,
  EVENTOS_AUDITAVEIS,
  type EnvioLido,
  type EstadoFhir,
  type EstadoHl7,
  type EstadoMensagens,
  esquemaAlteracaoParceiro,
  esquemaNovoParceiro,
  esquemaTratarMorto,
  LIMITE_MORTO_SEM_TRATAMENTO_MIN,
  type MonitorIntegracoes,
  type ParceiroLido,
  RECURSOS_FHIR_MAPEADOS,
  VERSAO_BR_CORE,
  type VisaoParceiro,
} from '@sgh/contratos';
import {
  alertasDeMortos,
  ambienteRnds,
  CANAIS_OIE,
  chaveEventoFato,
  imunizacaoFhir,
  minutosNaFilaDeMortos,
  organizacaoFhir,
  pacienteFhir,
  perfilBrCoreRecortado,
  profissionalFhir,
  validarRecurso,
} from '@sgh/dominio-integracao';
import type { Configuracao } from '../../../configuracao.js';
import { ErroProblema } from '../../../problema.filter.js';
import { linhaTrilha, type SessaoCadastro } from '../../cadastro/comum.js';
import type { ConfiguracaoM34 } from '../../relatorio/public-api.js';
import type { EnvioIntegracao, ParceiroIntegracao, PortaIntegracao } from '../porta.js';
import { novaCredencial, resumoDoSegredo } from './credencial.js';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 19) : null);
const sujeito = (s: SessaoCadastro) => ({
  rede: s.rede,
  hospital: s.hospital,
  login: s.login,
  setor: s.req.sgh?.sessao.unidadeAtiva ?? null,
});

function invalido(issues: readonly { message: string; path: readonly PropertyKey[] }[]): ErroProblema {
  return new ErroProblema(
    'entrada-invalida',
    400,
    'Dados inválidos',
    issues.map((i) => i.message).join(' '),
    {
      campos: issues.map((i) => String(i.path[0] ?? '')),
    },
  );
}

export function envioLido(e: EnvioIntegracao, agora: Date): EnvioLido {
  return {
    id: e.id,
    evento: e.chaveEvento,
    tipoEvento: e.tipoEvento,
    parceiro: e.parceiro,
    chaveOrdem: e.chaveOrdem,
    objeto: e.tabelaFato && e.idFato ? `${e.tabelaFato} ${e.idFato}` : null,
    situacao: e.situacao,
    tentativas: e.tentativas,
    proximaTentativaEm: iso(e.proximaTentativaEm),
    enviadoEm: iso(e.enviadoEm),
    recibo: e.recibo,
    resposta: e.resposta,
    resumoConteudo: e.hashConteudo,
    mortoEm: iso(e.mortoEm),
    minutosMorto: e.situacao === 'morto' && e.mortoEm ? minutosNaFilaDeMortos(e.mortoEm, agora) : null,
    tratamento: e.tratamento,
    tratadoPor: e.tratadoPor,
    motivoTratamento: e.motivoTratamento,
    criadoEm: iso(e.criadoEm) ?? '',
  };
}

const parceiroLido = (p: ParceiroIntegracao): ParceiroLido => ({
  id: p.id,
  codigo: p.codigo,
  nome: p.nome,
  tipo: p.tipo as ParceiroLido['tipo'],
  canal: p.canal,
  clienteId: p.clienteId,
  temSegredo: p.temSegredo,
  escopos: [...p.escopos],
  eventos: [...p.eventos],
  limiteTentativas: p.limiteTentativas,
  finalidade: p.finalidade,
  baseLegal: ((BASES_LEGAIS as readonly string[]).includes(p.baseLegal)
    ? p.baseLegal
    : 'tutela-da-saude') as ParceiroLido['baseLegal'],
  ativo: p.ativo,
  criadoPor: p.criadoPor,
  alteradoEm: iso(p.alteradoEm),
});

/** Os recursos de exemplo (sintéticos) de cada perfil, validados contra o recorte da versão fixada. */
export function perfisValidados(): EstadoFhir['perfis'] {
  const exemplos: Record<string, Record<string, unknown>> = {
    Patient: pacienteFhir({
      id: 1,
      cpf: '111.444.777-35',
      cns: null,
      nome: 'Paciente Fictício Um',
      nascimento: new Date('1980-02-03T00:00:00Z'),
      sexo: 'F',
    }),
    Organization: organizacaoFhir({
      cnes: '1234567',
      cnpj: '00.000.000/0001-91',
      nome: 'Estabelecimento Sintético',
      apelido: 'Sintético',
      cidade: 'Cidade Sintética',
      uf: 'RJ',
    }),
    Practitioner: profissionalFhir({
      id: 9,
      cpf: '111.444.777-35',
      cns: null,
      nome: 'Profissional Fictício',
      conselho: { sigla: 'COREN', uf: 'RJ', numero: '123456' },
      ativo: true,
    }),
    Immunization: imunizacaoFhir({
      id: 'vac-1',
      paciente: 'pac-1001',
      profissional: 'prof-9',
      estabelecimento: 'est-1234567',
      vacina: { codigo: '86', nome: 'Vacina sintética' },
      aplicadaEm: new Date('2026-10-22T10:00:00Z'),
      lote: 'L123',
      fabricante: null,
      via: 'IM',
      local: 'DD',
      dose: 'D1',
    }),
  };
  return RECURSOS_FHIR_MAPEADOS.map((recurso) => {
    const perfil = perfilBrCoreRecortado(recurso);
    let valido: boolean;
    try {
      valido = perfil !== undefined && validarRecurso(exemplos[recurso] ?? {}, perfil).length === 0;
    } catch {
      valido = false;
    }
    return { recurso, perfil: perfil ? `${perfil.url}|${perfil.versao}` : 'sem perfil', valido };
  });
}

export class ServicoIntegracoes {
  constructor(
    private readonly porta: PortaIntegracao,
    private readonly config: ConfiguracaoM34,
    private readonly configuracao: Configuracao,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  // ── Monitor de filas e reprocessamento (regras 8 a 10) ─────────────────────────────────────────────────

  async monitor(s: SessaoCadastro): Promise<MonitorIntegracoes> {
    const agora = await this.porta.relogio(s.porta);
    const [cont, mortos, filas, limite] = await Promise.all([
      this.porta.contagens(s.porta),
      this.porta.mortos(s.porta),
      this.porta.saudeFilas(s.porta).catch(() => null),
      this.config.inteiro(s, 'integracao.alertaMortoMinutos', LIMITE_MORTO_SEM_TRATAMENTO_MIN),
    ]);
    return {
      outbox: cont.outbox.map((x) => ({ situacao: x.situacao, tipo: x.chave, quantidade: x.quantidade })),
      envios: cont.envios.map((x) => ({
        parceiro: x.chave,
        situacao: x.situacao as EnvioLido['situacao'],
        quantidade: x.quantidade,
      })),
      entradas: cont.entradas.map((x) => ({
        parceiro: x.chave,
        situacao: x.situacao,
        quantidade: x.quantidade,
      })),
      mortos: mortos.map((m) => envioLido(m, agora)),
      alertas: alertasDeMortos(
        mortos
          .filter((m) => m.mortoEm)
          .map((m) => ({ id: m.id, parceiro: m.parceiro, mortoEm: m.mortoEm!, tratado: false })),
        limite,
        agora,
      ).map((a) => ({ envio: a.id, parceiro: a.parceiro, minutos: a.minutos })),
      legado: filas ? { ...filas, medidoEm: iso(agora)! } : null,
      medidoEm: iso(agora)!,
    };
  }

  async envios(s: SessaoCadastro, q: Record<string, string | undefined>): Promise<EnvioLido[]> {
    const agora = await this.porta.relogio(s.porta);
    const situacao = ['pendente', 'enviado', 'morto', 'descartado'].includes(q['situacao'] ?? '')
      ? q['situacao']
      : undefined;
    const parceiro = q['parceiro'] && /^[a-z0-9-]{3,40}$/.test(q['parceiro']) ? q['parceiro'] : undefined;
    const l = await this.porta.envios(s.porta, {
      ...(situacao ? { situacao } : {}),
      ...(parceiro ? { parceiro } : {}),
      limite: 100,
    });
    return l.map((e) => envioLido(e, agora));
  }

  async tratarMorto(s: SessaoCadastro, id: string, corpo: unknown): Promise<EnvioLido> {
    if (!/^\d{1,20}$/.test(id)) throw new ErroProblema('nao-encontrado', 404, 'Mensagem não encontrada');
    const t = esquemaTratarMorto.safeParse(corpo);
    if (!t.success) throw invalido(t.error.issues);
    const e = await this.porta.envio(s.porta, id);
    if (!e) throw new ErroProblema('nao-encontrado', 404, 'Mensagem não encontrada');
    if (e.situacao !== 'morto')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'A mensagem não está na fila de mortos',
        'Só a mensagem morta é tratada.',
      );
    const n = await this.porta.gravar(
      s.porta,
      linhaTrilha(s, EVENTOS_AUDITAVEIS.integracaoMortoTratado.codigo, 'integracao.fila', t.data.acao, {
        tabela: 'mensagem_integracao_saida',
        id,
        chave: e.parceiro,
      }),
      (g) => g.tratarMorto(id, { acao: t.data.acao, motivo: t.data.motivo, usuario: s.login }),
    );
    if (n !== 1)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'A mensagem mudou',
        'Atualize o monitor e tente de novo.',
      );
    return envioLido((await this.porta.envio(s.porta, id))!, await this.porta.relogio(s.porta));
  }

  // ── Parceiros (regras 12, 14 e 16) ──────────────────────────────────────────────────────────────────

  async parceiros(s: SessaoCadastro): Promise<{
    novos: ParceiroLido[];
    leemOBanco: (VisaoParceiro & { oferta: string[] })[];
    eventosDosGatilhos: readonly string[];
  }> {
    // Os parceiros não leem o banco por visões (o acesso é só pela API, com escopo e credencial próprios) e nenhum
    // gatilho envia evento (regra de ouro 2): as duas listas do contrato saem vazias até o contrato tirá-las.
    const novos = await this.porta.parceiros(s.porta);
    return { novos: novos.map(parceiroLido), leemOBanco: [], eventosDosGatilhos: [] };
  }

  async criarParceiro(
    s: SessaoCadastro,
    corpo: unknown,
  ): Promise<{ parceiro: ParceiroLido; credencial: CredencialEmitida }> {
    const p = esquemaNovoParceiro.safeParse(corpo);
    if (!p.success) throw invalido(p.error.issues);
    if (await this.porta.parceiro(s.porta, p.data.codigo))
      throw new ErroProblema('recusa-de-negocio', 409, 'Já existe parceiro com este código', undefined, {
        codigo: 'duplicado',
      });
    const cred = novaCredencial(p.data.codigo);
    const resumo = resumoDoSegredo(cred.segredo);
    await this.porta.gravar(
      s.porta,
      linhaTrilha(s, EVENTOS_AUDITAVEIS.integracaoParceiroAlterado.codigo, 'integracao.parceiro', 'criar', {
        tabela: 'parceiro_dados',
        id: null,
        chave: p.data.tipo,
      }),
      async (g) => {
        await g.criarParceiro(p.data, s.login);
        await g.gravarCredencial(p.data.codigo, cred.clienteId, resumo, s.login);
      },
    );
    return { parceiro: parceiroLido((await this.porta.parceiro(s.porta, p.data.codigo))!), credencial: cred };
  }

  async alterarParceiro(s: SessaoCadastro, codigo: string, corpo: unknown): Promise<ParceiroLido> {
    const p = esquemaAlteracaoParceiro.safeParse(corpo);
    if (!p.success) throw invalido(p.error.issues);
    const atual = await this.porta.parceiro(s.porta, codigo);
    if (!atual) throw new ErroProblema('nao-encontrado', 404, 'Parceiro não encontrado');
    // Os eventos já foram validados contra o catálogo do que a outbox publica (EVENTOS_INTEGRACAO, no esquema): no
    // banco próprio nenhum gatilho envia evento, então não há trava de convivência.
    const { motivo, ...resto } = p.data;
    const n = await this.porta.gravar(
      s.porta,
      linhaTrilha(
        s,
        EVENTOS_AUDITAVEIS.integracaoParceiroAlterado.codigo,
        'integracao.parceiro',
        `${p.data.ativo === atual.ativo ? 'alterar' : p.data.ativo ? 'ativar' : 'desativar'}:${motivo.slice(0, 60)}`,
        { tabela: 'parceiro_dados', id: atual.id, chave: atual.tipo },
      ),
      (g) => g.alterarParceiro(codigo, resto, s.login),
    );
    if (n !== 1) throw new ErroProblema('nao-encontrado', 404, 'Parceiro não encontrado');
    return parceiroLido((await this.porta.parceiro(s.porta, codigo))!);
  }

  async trocarCredencial(s: SessaoCadastro, codigo: string): Promise<CredencialEmitida> {
    const atual = await this.porta.parceiro(s.porta, codigo);
    if (!atual) throw new ErroProblema('nao-encontrado', 404, 'Parceiro não encontrado');
    const cred = novaCredencial(codigo);
    await this.porta.gravar(
      s.porta,
      linhaTrilha(
        s,
        EVENTOS_AUDITAVEIS.integracaoParceiroAlterado.codigo,
        'integracao.parceiro',
        'credencial',
        {
          tabela: 'parceiro_dados',
          id: atual.id,
          chave: atual.tipo,
        },
      ),
      (g) => g.gravarCredencial(codigo, cred.clienteId, resumoDoSegredo(cred.segredo), s.login),
    );
    return cred;
  }

  /**
   * A mensagem de teste a um parceiro ativo (regra 7): o evento `integracao.teste` na SGH_OUTBOX, na mesma transação
   * da trilha; o relay e o consumidor do worker entregam pelo caminho de qualquer integração.
   */
  async mensagemDeTeste(s: SessaoCadastro, codigo: string): Promise<{ evento: string }> {
    const p = await this.porta.parceiro(s.porta, codigo);
    if (!p) throw new ErroProblema('nao-encontrado', 404, 'Parceiro não encontrado');
    if (!p.ativo)
      throw new ErroProblema(
        'operacao-bloqueada',
        409,
        'Parceiro desativado',
        'Ative o parceiro antes do teste.',
      );
    const agora = await this.porta.relogio(s.porta);
    const chave = chaveEventoFato(
      'integracao.teste',
      s.hospital,
      `${p.id}-${agora.getTime() % 1_000_000_000}`,
      agora,
    );
    await this.porta.gravar(
      s.porta,
      linhaTrilha(
        s,
        EVENTOS_AUDITAVEIS.integracaoConfiguracaoAlterada.codigo,
        'integracao.parceiro',
        'teste',
        {
          tabela: 'integracao_mensagem',
          id: p.id,
          chave,
        },
      ),
      (g) => g.outbox({ tipo: 'integracao.teste', chave, carga: { parceiro: codigo, origem: 'teste' } }),
    );
    return { evento: chave };
  }

  // ── FHIR R4 e RNDS (regra 14) ───────────────────────────────────────────────────────────────────────

  async fhir(s: SessaoCadastro): Promise<EstadoFhir> {
    const e = await this.config.estado(sujeito(s), 'integracao.rndsVacina');
    const ident = await this.porta.identificacao(s.porta).catch(() => ({
      pacientesComCpf: 'não medido',
      pacientesComCns: 'não medido',
      profissionaisComCns: 'não medido',
      estabelecimentoComCnes: false,
    }));
    return {
      versaoBrCore: VERSAO_BR_CORE,
      perfis: perfisValidados(),
      rnds: {
        ambiente: ambienteRnds(this.configuracao.ambiente, this.env['RNDS_HOMOLOGACAO_AUTORIZADA'] === 'sim'),
        envioVacina: { ligado: e.ligado, motivo: e.motivo },
        prerequisitos: [...e.prerequisitos],
      },
      identificacao: ident,
    };
  }

  /** O recurso de teste ao simulador ou à homologação da RNDS (nunca produção fora de produção; sem dado real). */
  async enviarTesteFhir(
    s: SessaoCadastro,
  ): Promise<{ ambiente: string; valido: boolean; problemas: string[]; recibo: string }> {
    const ambiente = ambienteRnds(
      this.configuracao.ambiente,
      this.env['RNDS_HOMOLOGACAO_AUTORIZADA'] === 'sim',
    );
    if (ambiente === 'producao')
      throw new ErroProblema(
        'operacao-bloqueada',
        409,
        'Envio de teste só fora de produção',
        'Em produção, a RNDS recebe só os fatos reais.',
      );
    const recurso = pacienteFhir({
      id: 1,
      cpf: '111.444.777-35',
      cns: null,
      nome: 'Paciente Fictício Um',
      nascimento: new Date('1980-02-03T00:00:00Z'),
      sexo: 'F',
    });
    const perfil = perfilBrCoreRecortado('Patient');
    const problemas = perfil
      ? validarRecurso(recurso, perfil).map((p) => `${p.caminho}: ${p.mensagem}`)
      : ['sem perfil'];
    const recibo = `${ambiente}-${(await this.porta.relogio(s.porta)).getTime().toString(36)}`;
    await this.porta.gravar(
      s.porta,
      linhaTrilha(
        s,
        EVENTOS_AUDITAVEIS.integracaoConfiguracaoAlterada.codigo,
        'integracao.fhir',
        `teste:${ambiente}`,
        {
          tabela: 'mensagem_integracao_saida',
          id: null,
          chave: 'Patient',
        },
      ),
      async () => undefined,
    );
    return { ambiente, valido: problemas.length === 0, problemas, recibo };
  }

  // ── HL7 v2 e o motor de integração (regra 12) ───────────────────────────────────────────────────────

  async hl7(s: SessaoCadastro): Promise<EstadoHl7> {
    const chaves = [...new Set(CANAIS_OIE.map((c) => c.chave))];
    const [estados, saude, parceiros] = await Promise.all([
      this.config.estados(sujeito(s), chaves),
      this.porta.saudeFilas(s.porta).catch(() => null),
      this.porta.parceiros(s.porta),
    ]);
    const endereco = this.env['OIE_URL']?.trim() || null;
    let acessivel: boolean | null = null;
    if (endereco)
      acessivel = await fetch(`${endereco.replace(/\/+$/, '')}/api/server/status`, {
        signal: AbortSignal.timeout(2_000),
        headers: { 'X-Requested-With': 'OpenAPI' },
      })
        .then((r) => r.status < 500)
        .catch(() => false);
    const classif = parceiros.find((p) => p.canal === 'oie-classificacao-adt');
    return {
      canais: CANAIS_OIE.map((c) => ({
        canal: c.canal,
        versao: c.versao,
        descricao: c.descricao,
        mensagem: c.mensagem,
        direcao: c.direcao,
        destino: c.destino,
        ligado: estados[c.chave]?.ligado === true && parceiros.some((p) => p.canal === c.canal && p.ativo),
      })),
      motor: { endereco, acessivel },
      classificacaoExterna: {
        caminho:
          estados['integracao.classificacaoExterna']?.ligado && classif?.ativo
            ? 'motor-de-integracao'
            : 'nenhum',
        decisao:
          'DP-16: a classificação de risco externa vai pelo gatilho em uso OU pelo motor de integração, nunca pelos dois; até a confirmação da TI e da diretoria clínica, nenhum envio novo.',
      },
      filasLegado: (saude?.filas ?? []).map((f) => ({
        fila: f.fila,
        quantidade: f.quantidade,
        maisAntiga: f.maisAntiga,
      })),
    };
  }

  // ── Comunicação com o paciente pela Hal-AI (regra 15a; DP-44 b) ─────────────────────────────────────

  async mensagens(s: SessaoCadastro): Promise<EstadoMensagens> {
    const [endereco, e] = await Promise.all([
      this.config.parametro(s, 'integracao.halaiEndereco'),
      this.config.estado(sujeito(s), 'integracao.mensagensPaciente'),
    ]);
    return {
      enderecoApi: typeof endereco === 'string' && endereco !== '' ? endereco : null,
      tokenConfigurado: Boolean(this.env[`HALAI_TOKEN_${s.hospital.toUpperCase()}`]?.trim()),
      envioLigado: e.ligado,
      motivo: e.motivo,
      canalProprio: false,
    };
  }
}
