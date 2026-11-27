// Restrições próprias do hospital no apoio à decisão da prescrição EM MEMÓRIA (03-PEP L108, C2-104): a porta da fonte
// sintética (dev, CI e E2E sem banco), com o mesmo contrato da porta própria (PortaRestricoesPrescricao) e as mesmas
// regras: os esquemas de entrada, as regras do domínio (problemasFaixaRenal, problemasRestricao), o alvo obrigatório e
// existente, a unidade da dose, a versão lida, a vigência e a configuração repetida no mesmo escopo. Nada é apagado:
// desligar é gravar com ativo = false. Produtos, princípios, setores e regras são SINTÉTICOS.
import { problemasFaixaRenal, problemasRestricao } from '@sgh/dominio-pep';
import type { z } from 'zod';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { PRODUTOS } from './prescricao-porta-memoria.js';
import type {
  ContextoCadastroCatalogo,
  ContextoGravacaoCatalogo,
  Gravado,
} from './prescricao-propria-cadastro.js';
import {
  type EntradaAjusteRenal,
  type EntradaConfiguracaoAlerta,
  type EntradaRestricaoPosologia,
  esquemaAjuste,
  esquemaConfiguracao,
  esquemaRestricao,
  type PortaRestricoesPrescricao,
  recusar,
  recusarProblemas,
} from './prescricao-propria-restricoes.js';

type Cadastro = Awaited<ReturnType<PortaRestricoesPrescricao['cadastro']>>;
type Linha<T> = T & { id: number; versao: number; estabelecimento: string | null };

const SETORES = [
  { id: 1, nome: 'UTI ADULTO SINTETICA' },
  { id: 2, nome: 'PEDIATRIA SINTETICA' },
  { id: 3, nome: 'CLINICA MEDICA SINTETICA' },
];
const REGRAS = [
  { id: 1, codigo: 'DOSE_MAXIMA', tipo: 'dose' },
  { id: 2, codigo: 'INTERACAO', tipo: 'interacao' },
  { id: 3, codigo: 'AJUSTE_RENAL', tipo: 'renal' },
  { id: 4, codigo: 'ALTA_VIGILANCIA', tipo: 'alto_alerta' },
];
const VIAS = [
  { id: 1, nome: 'EV' },
  { id: 2, nome: 'IM' },
  { id: 3, nome: 'SC' },
  { id: 4, nome: 'VO' },
];
const SEXOS = [
  { id: 1, nome: 'Feminino' },
  { id: 2, nome: 'Masculino' },
];
const UNIDADES = [
  { id: 1, nome: 'G' },
  { id: 2, nome: 'MG' },
  { id: 3, nome: 'ML' },
  { id: 4, nome: 'UI' },
];

function nomeDoAlvo(item: number | null, principio: number | null): string | null {
  if (principio !== null)
    for (const p of PRODUTOS) {
      const x = p.principios.find((q) => q.id === principio);
      if (x) return x.nome;
    }
  if (item !== null) return PRODUTOS.find((p) => p.produto === item)?.nome ?? null;
  return null;
}

export class CadastroRestricoesPrescricaoMemoria implements PortaRestricoesPrescricao {
  private seq = 0;
  private readonly ajustes: Linha<EntradaAjusteRenal>[] = [];
  private readonly restricoes: Linha<EntradaRestricaoPosologia>[] = [];
  private readonly configuracoes: Linha<EntradaConfiguracaoAlerta>[] = [];

  constructor(private readonly trilha: RegistradorTrilha | null = null) {}

  private static visivel(est: string | null, hospital: string): boolean {
    return est === null || est === hospital;
  }

  cadastro(c: ContextoCadastroCatalogo): Promise<Cadastro> {
    const alvo = (x: { item: number | null; principio: number | null }) => ({
      item: x.item,
      principio: x.principio,
      alvoNome: nomeDoAlvo(x.item, x.principio) ?? '',
    });
    const ordem = (a: { ativo: boolean; id: number }, b: { ativo: boolean; id: number }) =>
      Number(b.ativo) - Number(a.ativo) || a.id - b.id;
    return Promise.resolve({
      ajustes: [...this.ajustes].sort(ordem).map((x) => ({
        id: x.id,
        versao: x.versao,
        ...alvo(x),
        criterio: x.criterio as string,
        faixaMinima: x.faixaMinima,
        faixaMaxima: x.faixaMaxima,
        classeHepatica: x.classeHepatica as string | null,
        modalidadeDialise: x.modalidadeDialise as string | null,
        ajuste: x.ajuste as string,
        percentualDose: x.percentualDose,
        doseMaxima: x.doseMaxima,
        unidade: x.unidade,
        intervaloHoras: x.intervaloHoras,
        comportamento: x.comportamento as string,
        orientacao: x.orientacao,
        ativo: x.ativo,
      })),
      restricoes: this.restricoes
        .filter((x) => CadastroRestricoesPrescricaoMemoria.visivel(x.estabelecimento, c.hospital))
        .sort(ordem)
        .map((x) => ({
          id: x.id,
          versao: x.versao,
          ...alvo(x),
          todosEstabelecimentos: x.estabelecimento === null,
          setor: x.setor,
          via: x.via,
          forma: x.forma,
          sexo: x.sexo,
          idadeMinimaDias: x.idadeMinimaDias,
          idadeMaximaDias: x.idadeMaximaDias,
          pesoMinimoKg: x.pesoMinimoKg,
          pesoMaximoKg: x.pesoMaximoKg,
          gestante: x.gestante,
          lactante: x.lactante,
          tipo: x.tipo as string,
          doseMaxima: x.doseMaxima,
          doseMaximaDiaria: x.doseMaximaDiaria,
          unidade: x.unidade,
          acao: x.acao as string,
          mensagem: x.mensagem,
          ativo: x.ativo,
        })),
      configuracoes: this.configuracoes
        .filter((x) => CadastroRestricoesPrescricaoMemoria.visivel(x.estabelecimento, c.hospital))
        .sort(ordem)
        .map((x) => {
          const r = REGRAS.find((q) => q.id === x.regra)!;
          return {
            id: x.id,
            versao: x.versao,
            regra: x.regra,
            regraCodigo: r.codigo,
            tipo: r.tipo,
            todosEstabelecimentos: x.estabelecimento === null,
            setor: x.setor,
            gatilhoItem: x.gatilhoItem,
            comportamento: x.comportamento as string,
            vigenciaInicio: x.vigenciaInicio,
            vigenciaFim: x.vigenciaFim,
            ativo: x.ativo,
          };
        }),
      apoio: {
        regras: REGRAS.map((r) => ({ id: r.id, nome: `${r.codigo} (${r.tipo})` })),
        setores: SETORES.map((s) => ({ ...s })),
        vias: VIAS.map((v) => ({ ...v })),
        sexos: SEXOS.map((s) => ({ ...s })),
        unidades: UNIDADES.map((u) => ({ ...u })),
      },
    } as Cadastro);
  }

  private static ler<E>(esquema: z.ZodType<E>, entrada: unknown): E {
    const r = esquema.safeParse(entrada);
    if (!r.success) {
      const q = r.error.issues[0];
      recusar(400, 'entrada-invalida', q?.message ?? 'Entrada inválida.', q?.path.join('.'));
    }
    return (r as { data: E }).data;
  }

  private static conferirAlvo(item: number | null, principio: number | null): void {
    if (item === null && principio === null)
      recusar(422, 'alvo-obrigatorio', 'Escolha o item ou o princípio ativo.', 'item');
    if (item !== null && !PRODUTOS.some((p) => p.produto === item))
      recusar(404, 'registro-inexistente', 'O item não existe neste cliente.', 'item');
    if (principio !== null && !PRODUTOS.some((p) => p.principios.some((q) => q.id === principio)))
      recusar(404, 'registro-inexistente', 'O princípio ativo não existe neste cliente.', 'principio');
  }

  private static conferirSetor(setor: number | null): void {
    if (setor !== null && !SETORES.some((s) => s.id === setor))
      recusar(404, 'registro-inexistente', 'O setor não existe neste estabelecimento.', 'setor');
  }

  /** Inclui, ou altera com a versão lida (a linha de outro estabelecimento não se altera daqui). */
  private gravarLinha<T extends { id?: number | undefined; versao?: number | undefined }>(
    lista: Linha<Omit<T, 'id' | 'versao'>>[],
    e: T,
    estabelecimento: string | null,
    hospital: string,
    vePorEstabelecimento: boolean,
  ): Gravado {
    const { id, versao, ...valores } = e;
    if (!id) {
      const nova = { ...valores, id: ++this.seq, versao: 1, estabelecimento } as Linha<
        Omit<T, 'id' | 'versao'>
      >;
      lista.push(nova);
      return { id: nova.id, versao: 1 };
    }
    if (!versao) recusar(400, 'versao-obrigatoria', 'Informe a versão lida.', 'versao');
    const i = lista.findIndex(
      (x) =>
        x.id === id &&
        (!vePorEstabelecimento || CadastroRestricoesPrescricaoMemoria.visivel(x.estabelecimento, hospital)),
    );
    if (i < 0) recusar(404, 'registro-inexistente', 'O registro não existe neste cliente.');
    if (lista[i]!.versao !== versao)
      recusar(409, 'versao-desatualizada', 'O registro mudou desde a leitura: leia de novo.');
    lista[i] = { ...valores, id, versao: versao! + 1, estabelecimento } as Linha<Omit<T, 'id' | 'versao'>>;
    return { id, versao: versao! + 1 };
  }

  private async trilhar(c: ContextoGravacaoCatalogo, tabela: string, g: Gravado): Promise<Gravado> {
    await this.trilha?.registrar({
      evento: 'pep.regraAlerta.alterada',
      rede: c.hospital,
      hospital: c.hospital,
      usuario: c.login,
      estacao: '',
      correlacao: (c.correlacao || 'pep.restricoes').slice(0, 64),
      recurso: 'pep.restricoes',
      resultado: 'sucesso',
      tabelaAlvo: tabela,
      idAlvo: String(g.id),
    });
    return g;
  }

  gravarAjusteRenal(c: ContextoGravacaoCatalogo, entrada: unknown): Promise<Gravado> {
    return Promise.resolve().then(() => {
      const e = CadastroRestricoesPrescricaoMemoria.ler(
        esquemaAjuste as unknown as z.ZodType<EntradaAjusteRenal>,
        entrada,
      );
      recusarProblemas(problemasFaixaRenal(e));
      CadastroRestricoesPrescricaoMemoria.conferirAlvo(e.item, e.principio);
      if (e.doseMaxima !== null && e.unidade === null)
        recusar(422, 'unidade-obrigatoria', 'A dose máxima pede a unidade.', 'unidade');
      const g = this.gravarLinha(this.ajustes, e, null, c.hospital, false);
      return this.trilhar(c, 'ajuste_dose_renal', g);
    });
  }

  gravarRestricao(c: ContextoGravacaoCatalogo, entrada: unknown): Promise<Gravado> {
    return Promise.resolve().then(() => {
      const e = CadastroRestricoesPrescricaoMemoria.ler(
        esquemaRestricao as unknown as z.ZodType<EntradaRestricaoPosologia>,
        entrada,
      );
      recusarProblemas(
        problemasRestricao({ ...e, via: e.via === null ? null : String(e.via), setor: e.setor }),
      );
      CadastroRestricoesPrescricaoMemoria.conferirAlvo(e.item, e.principio);
      if (e.tipo === 'forma_proibida' && (e.forma === null || e.item === null))
        recusar(422, 'forma-exige-item', 'Forma proibida pede o item e a forma.', 'forma');
      if (e.tipo === 'dose_maxima' && e.unidade === null)
        recusar(422, 'unidade-obrigatoria', 'O limite de dose pede a unidade.', 'unidade');
      CadastroRestricoesPrescricaoMemoria.conferirSetor(e.setor);
      const est = e.todosEstabelecimentos ? null : c.hospital;
      const g = this.gravarLinha(this.restricoes, e, est, c.hospital, true);
      return this.trilhar(c, 'restricao_posologia', g);
    });
  }

  gravarConfiguracao(c: ContextoGravacaoCatalogo, entrada: unknown): Promise<Gravado> {
    return Promise.resolve().then(() => {
      const e = CadastroRestricoesPrescricaoMemoria.ler(
        esquemaConfiguracao as unknown as z.ZodType<EntradaConfiguracaoAlerta>,
        entrada,
      );
      if (e.vigenciaInicio && e.vigenciaFim && e.vigenciaFim < e.vigenciaInicio)
        recusar(422, 'vigencia-invertida', 'O fim da vigência vem antes do início.', 'vigenciaFim');
      if (!REGRAS.some((r) => r.id === e.regra))
        recusar(404, 'registro-inexistente', 'A regra de alerta não existe neste estabelecimento.', 'regra');
      CadastroRestricoesPrescricaoMemoria.conferirSetor(e.setor);
      const est = e.todosEstabelecimentos ? null : c.hospital;
      const igual = this.configuracoes.some(
        (x) =>
          x.regra === e.regra &&
          x.estabelecimento === est &&
          x.setor === e.setor &&
          x.gatilhoItem === e.gatilhoItem &&
          x.id !== (e.id ?? 0),
      );
      if (igual)
        recusar(
          409,
          'configuracao-repetida',
          'Já há configuração desta regra neste escopo: altere a existente.',
        );
      const g = this.gravarLinha(this.configuracoes, e, est, c.hospital, true);
      return this.trilhar(c, 'configuracao_alerta_prescricao', g);
    });
  }
}
