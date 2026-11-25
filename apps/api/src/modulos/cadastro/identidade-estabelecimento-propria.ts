// Identidade do estabelecimento no banco próprio (F3.1, 02-CAD linha 26): logotipos e mantenedora.
// - logotipo: a imagem (PNG ou JPEG, conferida pelo conteúdo) entra pela porta de arquivos (disco local, ADR 0004) com
//   a finalidade "logotipo" e o estabelecimento como dono; um envio serve a várias finalidades de uso de uma vez; cada
//   finalidade tem um só ativo (o envio novo aposenta o anterior, que fica no histórico); a sequência nunca é
//   reaproveitada; alterar cabeçalho, rodapé e situação com versão (409); excluir é exclusão lógica, com motivo na
//   trilha (o arquivo fica);
// - mantenedora: a pessoa jurídica que responde pelo estabelecimento (uma por CNPJ; a pessoa jurídica do CNPJ é
//   reaproveitada quando já existe, sem perder o que ela já tem), com os dados fiscais; gravar liga o estabelecimento da
//   sessão quando ele não tem mantenedora; ligar a outra
//   já cadastrada (rede com vários hospitais) ou desligar; inativar só a que nenhum estabelecimento usa.
// A regra é a do domínio (@sgh/dominio-organizacao); aqui só leitura, conferência no banco e gravação pelo executor
// (trilha e idempotência na mesma transação).
import { randomUUID } from 'node:crypto';
import {
  aposentadosPeloEnvio,
  errosAlterarLogotipo,
  errosArquivoLogotipo,
  errosInativarMantenedora,
  errosLogotipo,
  errosMantenedora,
  FINALIDADES_LOGOTIPO,
  lerImagem,
  type LogotipoExistente,
  proximaSequencia,
  TIPOS_DECLARANTE,
} from '@sgh/dominio-organizacao';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoArmazem,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { type ArquivosDoModulo, arquivosDoAmbiente } from '../arquivos-locais.js';
import type { ContextoPorta } from './porta.js';
import type { NucleoCadastro } from './porta-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

export const IDENTIDADE_ESTABELECIMENTO = Symbol('IDENTIDADE_ESTABELECIMENTO');

/** Finalidade do arquivo na porta de arquivos (dono: a tabela estabelecimento, o id dele). */
export const FINALIDADE_ARQUIVO_LOGOTIPO = 'logotipo';

const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean => v === true || v === 1 || v === '1';
const data = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : String(v).slice(0, 10);
const hoje = (): string => data(new Date())!;
const idPos = z.number().int().positive();
const txt = (max: number) => z.string().trim().min(1).max(max).nullable();
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const MENSAGENS: Record<string, [string, string]> = {
  'arquivo-vazio': ['Escolha a imagem do logotipo.', 'conteudo'],
  'arquivo-grande': ['A imagem do logotipo tem até 512 KB.', 'conteudo'],
  'arquivo-nao-imagem': ['O logotipo tem de ser imagem PNG ou JPEG.', 'conteudo'],
  'imagem-grande': ['A imagem tem até 4000 pontos no maior lado.', 'conteudo'],
  'imagem-pequena': ['A imagem tem ao menos 16 pontos no menor lado.', 'conteudo'],
  'finalidade-invalida': ['Finalidade de uso inválida.', 'finalidades'],
  'cabecalho-longo': ['O cabeçalho tem até 150 letras.', 'cabecalhoRelatorio'],
  'rodape-longo': ['O rodapé tem até 150 letras.', 'rodapeRelatorio'],
  'logotipo-inexistente': ['Logotipo não encontrado.', 'id'],
  'finalidade-com-logotipo-ativo': [
    'Esta finalidade já tem um logotipo ativo: inative-o antes ou envie a imagem nova, que o substitui.',
    'finalidade',
  ],
  'codigo-invalido': [
    'O código tem até 30 letras, dígitos, ponto, hífen ou sublinhado, sem espaço.',
    'codigo',
  ],
  'razao-social-vazia': ['Informe a razão social.', 'razaoSocial'],
  'cnpj-invalido': ['O CNPJ não confere (14 dígitos com os verificadores).', 'cnpj'],
  'nire-invalido': ['O registro na junta comercial tem 11 dígitos.', 'nire'],
  'data-nire-sem-numero': ['Data do registro na junta comercial sem o número.', 'nire'],
  'data-registro-civil-sem-numero': ['Data do registro em cartório sem o número.', 'registroCivil'],
  'data-nire-invalida': ['A data do registro na junta comercial não pode ser futura.', 'dataRegistroNire'],
  'data-registro-civil-invalida': [
    'A data do registro em cartório não pode ser futura.',
    'dataRegistroCivil',
  ],
  'cnae-invalido': ['A atividade econômica principal tem 7 dígitos.', 'cnaePrincipal'],
  'registro-ans-invalido': ['O registro na agência de saúde suplementar tem 6 dígitos.', 'registroAns'],
  'tipo-declarante-invalido': ['Tipo de declarante inválido.', 'tipoDeclarante'],
  'operadora-sem-registro-ans': [
    'Quem declara como operadora informa o registro na agência de saúde suplementar.',
    'registroAns',
  ],
  'crc-sem-contador': ['Registro do contador informado sem o contador.', 'contador'],
  'contador-igual-responsavel': ['O contador não é o responsável legal.', 'contador'],
  'site-invalido': ['Endereço do site inválido.', 'site'],
  'mantenedora-em-uso': [
    'Há estabelecimento ligado a esta mantenedora: ligue-o a outra antes de inativar.',
    'situacao',
  ],
};
function recusarErros(erros: readonly string[]): void {
  if (!erros.length) return;
  throw recusa(erros[0]!, erros.map((e) => MENSAGENS[e]?.[0] ?? e).join(' '), {
    campos: [...new Set(erros.map((e) => MENSAGENS[e]?.[1] ?? e))],
  });
}
const naoAchado = (o: string) =>
  new ErroOperacao(404, `${o.toLowerCase()}-inexistente`, 'Não encontrado', `${o} não encontrado.`);
const recusaCampo = (codigo: string, msg: string, campo: string) => recusa(codigo, msg, { campos: [campo] });
const motivoCurto = () => recusaCampo('motivo-curto', 'Escreva o motivo com ao menos 10 letras.', 'motivo');

/** Trava o estabelecimento (fila única das gravações de logotipo dele) e devolve os logotipos, com os excluídos. */
async function logotiposTravados(tx: TxOperacao, est: number) {
  await tx.consultarParaAtualizar('SELECT id FROM estabelecimento WHERE id = ?', [est]);
  const linhas = await tx.consultarParaAtualizar(
    `SELECT id, sequencia, finalidade, ativo, versao, excluido_em FROM logotipo_estabelecimento
      WHERE estabelecimento_id = ? ORDER BY sequencia`,
    [est],
  );
  return linhas.map((l) => ({
    id: Number(l['id']),
    sequencia: Number(l['sequencia']),
    finalidade: String(l['finalidade']),
    ativo: bool(l['ativo']),
    excluido: l['excluido_em'] !== null,
    versao: Number(l['versao']),
  })) satisfies (LogotipoExistente & { versao: number })[];
}

// ── Logotipo ──

const esquemaIncluirLogotipo = z
  .object({
    finalidades: z.array(z.string().max(30)).min(1).max(FINALIDADES_LOGOTIPO.length),
    arquivo: idPos,
    largura: idPos,
    altura: idPos,
    cabecalhoRelatorio: txt(150),
    rodapeRelatorio: txt(150),
    imprimeEmRelatorio: z.boolean(),
  })
  .strict();

const opIncluirLogotipo = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.logotipo.incluir',
    tabelas: ['logotipo_estabelecimento'],
    entrada: esquemaIncluirLogotipo,
    async gravar(tx, e, ctx) {
      const est = ctx.estabelecimento!;
      const finalidades = [...new Set(e.finalidades)];
      recusarErros([...new Set(finalidades.flatMap((finalidade) => errosLogotipo({ ...e, finalidade })))]);
      // Só o arquivo enviado como logotipo deste estabelecimento (nunca o documento ou a foto de um paciente).
      const a = await tx.uma(
        'SELECT tipo_mime, finalidade, entidade, entidade_id FROM arquivo WHERE id = ? AND excluido_em IS NULL',
        [e.arquivo],
      );
      if (
        !a ||
        a['finalidade'] !== FINALIDADE_ARQUIVO_LOGOTIPO ||
        a['entidade'] !== 'estabelecimento' ||
        Number(a['entidade_id']) !== est ||
        !['image/png', 'image/jpeg'].includes(String(a['tipo_mime']))
      )
        throw recusaCampo(
          'arquivo-nao-e-logotipo',
          'O arquivo não foi enviado como logotipo deste estabelecimento: envie a imagem pela tela.',
          'conteudo',
        );
      const existentes = await logotiposTravados(tx, est);
      let sequencia = proximaSequencia(existentes);
      const ids: number[] = [];
      for (const finalidade of finalidades) {
        for (const velho of aposentadosPeloEnvio(existentes, finalidade)) {
          const v = existentes.find((x) => x.id === velho.id)!;
          await tx.alterar('logotipo_estabelecimento', v.id, v.versao, { ativo: false });
        }
        ids.push(
          await tx.incluir('logotipo_estabelecimento', {
            estabelecimento_id: est,
            sequencia: sequencia++,
            finalidade,
            arquivo_id: e.arquivo,
            largura_px: e.largura,
            altura_px: e.altura,
            cabecalho_relatorio: e.cabecalhoRelatorio,
            rodape_relatorio: e.rodapeRelatorio,
            imprime_em_relatorio: e.imprimeEmRelatorio,
            ativo: true,
          }),
        );
      }
      return { id: ids[0]!, ids: ids.join(',') };
    },
    alvo: (_e, r) => ({ tabela: 'logotipo_estabelecimento', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const esquemaAlterarLogotipo = z
  .object({
    id: idPos,
    versao: idPos,
    finalidade: z.string().max(30),
    cabecalhoRelatorio: txt(150),
    rodapeRelatorio: txt(150),
    imprimeEmRelatorio: z.boolean(),
    ativo: z.boolean(),
  })
  .strict();
export type EntradaAlterarLogotipo = z.infer<typeof esquemaAlterarLogotipo>;

const opAlterarLogotipo = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.logotipo.alterar',
    tabelas: ['logotipo_estabelecimento'],
    entrada: esquemaAlterarLogotipo,
    acao: 'alteracao',
    async gravar(tx, e, ctx) {
      recusarErros(errosLogotipo(e));
      const existentes = await logotiposTravados(tx, ctx.estabelecimento!);
      const erros = errosAlterarLogotipo(existentes, e);
      if (erros[0] === 'logotipo-inexistente') throw naoAchado('Logotipo');
      recusarErros(erros);
      await tx.alterar('logotipo_estabelecimento', e.id, e.versao, {
        finalidade: e.finalidade,
        cabecalho_relatorio: e.cabecalhoRelatorio,
        rodape_relatorio: e.rodapeRelatorio,
        imprime_em_relatorio: e.imprimeEmRelatorio,
        ativo: e.ativo,
      });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'logotipo_estabelecimento', id: e.id }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const esquemaMotivo = z.object({ id: idPos, versao: idPos, motivo: z.string().trim().max(200) }).strict();
export type EntradaExcluirLogotipo = z.infer<typeof esquemaMotivo>;

const opExcluirLogotipo = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.logotipo.excluir',
    tabelas: ['logotipo_estabelecimento'],
    entrada: esquemaMotivo,
    acao: 'alteracao',
    async gravar(tx, e, ctx) {
      if (e.motivo.length < 10) throw motivoCurto();
      const existentes = await logotiposTravados(tx, ctx.estabelecimento!);
      const eu = existentes.find((l) => l.id === e.id);
      if (!eu || eu.excluido) throw naoAchado('Logotipo');
      // Exclusão lógica: a linha fica com quem e quando (inativa); o arquivo da imagem não é apagado.
      await tx.alterar('logotipo_estabelecimento', e.id, e.versao, {
        ativo: false,
        excluido_em: new Date(),
        excluido_por: ctx.usuario,
      });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'logotipo_estabelecimento', id: e.id }),
    trilha: (e) => ({ dados: t.dadosDepois ?? null, motivo: e.motivo }),
  });

// ── Mantenedora ──

const esquemaMantenedora = z
  .object({
    id: idPos.nullable(),
    versao: idPos.nullable(),
    codigo: z.string().trim().max(30),
    razaoSocial: z.string().trim().max(250),
    nomeFantasia: txt(150),
    cnpj: z.string().max(14),
    naturezaJuridica: idPos.nullable(),
    inscricaoEstadual: txt(20),
    inscricaoMunicipal: txt(20),
    nire: txt(15),
    dataRegistroNire: dia.nullable(),
    registroCivil: txt(20),
    dataRegistroCivil: dia.nullable(),
    cnaePrincipal: txt(7),
    registroAns: txt(10),
    optanteSimples: z.boolean(),
    filantropica: z.boolean(),
    incentivoCultural: z.boolean(),
    tipoDeclarante: txt(30),
    responsavel: idPos.nullable(),
    contador: idPos.nullable(),
    contadorCrc: txt(20),
    site: txt(254),
    /** Liga o estabelecimento da sessão a esta mantenedora na mesma gravação. */
    ligar: z.boolean(),
  })
  .strict();
export type EntradaMantenedora = z.infer<typeof esquemaMantenedora>;

async function pessoaExiste(tx: TxOperacao, id: number | null, campo: string): Promise<void> {
  if (id === null) return;
  if (!(await tx.uma('SELECT id FROM pessoa_fisica WHERE id = ? AND excluido_em IS NULL', [id])))
    throw recusaCampo(`${campo}-inexistente`, 'Pessoa escolhida não encontrada.', campo);
}

/** Liga (ou desliga, com null) o estabelecimento à mantenedora, com a versão lida sob trava. */
async function ligarEstabelecimento(tx: TxOperacao, est: number, mantenedora: number | null): Promise<void> {
  const [e] = await tx.consultarParaAtualizar(
    'SELECT id, versao, mantenedora_id FROM estabelecimento WHERE id = ? AND excluido_em IS NULL',
    [est],
  );
  if (!e) throw naoAchado('Estabelecimento');
  if (num(e['mantenedora_id']) === mantenedora) return;
  await tx.alterar('estabelecimento', est, Number(e['versao']), { mantenedora_id: mantenedora });
}

const opGravarMantenedora = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.mantenedora.gravar',
    tabelas: ['mantenedora', 'pessoa_juridica', 'estabelecimento'],
    entrada: esquemaMantenedora,
    async gravar(tx, e, ctx) {
      recusarErros(errosMantenedora(e, hoje()));
      if (e.naturezaJuridica !== null) {
        const n = await tx.uma('SELECT id FROM natureza_juridica WHERE id = ?', [e.naturezaJuridica]);
        if (!n)
          throw recusaCampo(
            'natureza-juridica-inexistente',
            'Natureza jurídica não encontrada.',
            'naturezaJuridica',
          );
      }
      await pessoaExiste(tx, e.responsavel, 'responsavel');
      await pessoaExiste(tx, e.contador, 'contador');
      if (await tx.uma('SELECT id FROM mantenedora WHERE codigo = ? AND id <> ?', [e.codigo, e.id ?? 0]))
        throw recusaCampo('codigo-repetido', 'Já existe mantenedora com este código.', 'codigo');
      // A pessoa jurídica é uma só por CNPJ: a que já existe é reaproveitada, nunca duplicada. Ela é cadastro
      // compartilhado (o mesmo CNPJ pode ser fornecedor, operadora, prestador): no reaproveitamento, o que já está
      // preenchido nela fica. Só a razão social e o nome fantasia informados a corrigem (são o nome da mesma pessoa
      // jurídica, e a mantenedora não tem cópia deles); os dados fiscais só completam o que está em branco (a
      // mantenedora guarda os dela nas próprias colunas). Nada informado em branco apaga valor. A escrita vai à
      // trilha da operação com a tabela, o id e as colunas mudadas.
      const dadosPj = {
        razao_social: e.razaoSocial,
        nome_fantasia: e.nomeFantasia,
        natureza_juridica_id: e.naturezaJuridica,
        inscricao_estadual: e.inscricaoEstadual,
        inscricao_municipal: e.inscricaoMunicipal,
        cnae_principal: e.cnaePrincipal,
        site: e.site,
      };
      const [pj] = await tx.consultarParaAtualizar(
        `SELECT id, versao, razao_social, nome_fantasia, natureza_juridica_id, inscricao_estadual,
                inscricao_municipal, cnae_principal, site
           FROM pessoa_juridica WHERE cnpj = ? AND excluido_em IS NULL`,
        [e.cnpj],
      );
      let pessoaJuridica: number;
      if (pj) {
        pessoaJuridica = Number(pj['id']);
        const outra = await tx.uma('SELECT id FROM mantenedora WHERE pessoa_juridica_id = ? AND id <> ?', [
          pessoaJuridica,
          e.id ?? 0,
        ]);
        if (outra) throw recusaCampo('cnpj-repetido', 'Outra mantenedora já usa este CNPJ.', 'cnpj');
        const mudancas: Record<string, string | number> = {};
        for (const [coluna, valor] of Object.entries(dadosPj)) {
          if (valor === null) continue;
          const atual = pj[coluna] ?? null;
          const corrige = coluna === 'razao_social' || coluna === 'nome_fantasia';
          if (atual === null ? true : corrige && String(atual) !== String(valor)) mudancas[coluna] = valor;
        }
        if (Object.keys(mudancas).length)
          await tx.alterar('pessoa_juridica', pessoaJuridica, Number(pj['versao']), mudancas);
      } else
        pessoaJuridica = await tx.incluir('pessoa_juridica', {
          cnpj: e.cnpj,
          estrangeira: false,
          situacao_cadastral: 'ativa',
          ...dadosPj,
        });
      // Ligar na mesma gravação só o estabelecimento sem mantenedora (ou já ligado a esta): trocar a mantenedora de
      // quem está ligado a outra é pela ligação, com motivo e a trilha no estabelecimento.
      if (e.ligar) {
        const est = await tx.uma('SELECT mantenedora_id FROM estabelecimento WHERE id = ?', [
          ctx.estabelecimento,
        ]);
        const atual = est ? num(est['mantenedora_id']) : null;
        if (atual !== null && atual !== e.id)
          throw recusaCampo(
            'estabelecimento-ja-ligado',
            'O estabelecimento já está ligado a outra mantenedora: troque pela ligação, com o motivo.',
            'ligar',
          );
      }
      const valores = {
        codigo: e.codigo,
        pessoa_juridica_id: pessoaJuridica,
        natureza_juridica_id: e.naturezaJuridica,
        inscricao_estadual: e.inscricaoEstadual,
        inscricao_municipal: e.inscricaoMunicipal,
        nire: e.nire,
        data_registro_nire: e.dataRegistroNire,
        registro_civil: e.registroCivil,
        data_registro_civil: e.dataRegistroCivil,
        cnae_principal: e.cnaePrincipal,
        registro_ans: e.registroAns,
        optante_simples: e.optanteSimples,
        filantropica: e.filantropica,
        incentivo_cultural: e.incentivoCultural,
        tipo_declarante_dmed: e.tipoDeclarante,
        responsavel_pessoa_fisica_id: e.responsavel,
        contador_pessoa_fisica_id: e.contador,
        contador_crc: e.contadorCrc,
        site: e.site,
      };
      let id: number;
      if (e.id === null) id = await tx.incluir('mantenedora', { ...valores, ativo: true });
      else {
        const x = await tx.uma('SELECT id, ativo FROM mantenedora WHERE id = ? AND excluido_em IS NULL', [
          e.id,
        ]);
        if (!x) throw naoAchado('Mantenedora');
        if (e.ligar && !bool(x['ativo']))
          throw recusaCampo(
            'mantenedora-inativa',
            'A mantenedora está inativa: reative-a antes.',
            'situacao',
          );
        await tx.alterar('mantenedora', e.id, e.versao ?? 0, valores);
        id = e.id;
      }
      if (e.ligar) await ligarEstabelecimento(tx, ctx.estabelecimento!, id);
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'mantenedora', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const esquemaLigar = z.object({ mantenedora: idPos.nullable(), motivo: z.string().trim().max(200) }).strict();
export type EntradaLigarMantenedora = z.infer<typeof esquemaLigar>;

const opLigarMantenedora = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.mantenedora.ligar',
    tabelas: ['estabelecimento'],
    entrada: esquemaLigar,
    acao: 'alteracao',
    async gravar(tx, e, ctx) {
      if (e.motivo.length < 10) throw motivoCurto();
      if (e.mantenedora !== null) {
        const x = await tx.uma('SELECT ativo FROM mantenedora WHERE id = ? AND excluido_em IS NULL', [
          e.mantenedora,
        ]);
        if (!x) throw naoAchado('Mantenedora');
        if (!bool(x['ativo']))
          throw recusaCampo(
            'mantenedora-inativa',
            'A mantenedora está inativa: reative-a antes.',
            'mantenedora',
          );
      }
      const antes = await tx.uma('SELECT mantenedora_id FROM estabelecimento WHERE id = ?', [
        ctx.estabelecimento,
      ]);
      if (antes && num(antes['mantenedora_id']) === e.mantenedora)
        throw recusaCampo('ligacao-igual', 'O estabelecimento já está nesta situação.', 'mantenedora');
      await ligarEstabelecimento(tx, ctx.estabelecimento!, e.mantenedora);
      return { id: ctx.estabelecimento! };
    },
    alvo: (_e, r) => ({ tabela: 'estabelecimento', id: Number(r.id) }),
    trilha: (e) => ({ dados: t.dadosDepois ?? null, motivo: e.motivo }),
  });

const esquemaSituacaoMantenedora = z
  .object({ id: idPos, versao: idPos, ativo: z.boolean(), motivo: z.string().trim().max(200) })
  .strict();
export type EntradaSituacaoMantenedora = z.infer<typeof esquemaSituacaoMantenedora>;

const opSituacaoMantenedora = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.mantenedora.situacao',
    tabelas: ['mantenedora'],
    entrada: esquemaSituacaoMantenedora,
    acao: 'alteracao',
    async gravar(tx, e) {
      if (e.motivo.length < 10) throw motivoCurto();
      const x = await tx.uma('SELECT ativo FROM mantenedora WHERE id = ? AND excluido_em IS NULL', [e.id]);
      if (!x) throw naoAchado('Mantenedora');
      if (bool(x['ativo']) === e.ativo)
        throw recusaCampo('situacao-igual', 'A mantenedora já está nesta situação.', 'situacao');
      if (!e.ativo) {
        const n = await tx.uma<{ n: unknown }>(
          'SELECT COUNT(*) AS n FROM estabelecimento WHERE mantenedora_id = ? AND excluido_em IS NULL',
          [e.id],
        );
        recusarErros(errosInativarMantenedora(Number(n?.n ?? 0)));
      }
      await tx.alterar('mantenedora', e.id, e.versao, { ativo: e.ativo });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'mantenedora', id: e.id }),
    trilha: (e) => ({ dados: t.dadosDepois ?? null, motivo: e.motivo }),
  });

// ── Porta ──

export interface EnvioLogotipo {
  conteudo: Uint8Array;
  nomeOriginal: string;
  finalidades: string[];
  cabecalhoRelatorio: string | null;
  rodapeRelatorio: string | null;
  imprimeEmRelatorio: boolean;
}

const COLUNAS_MANTENEDORA = `m.id, m.versao, m.codigo, m.ativo, pj.razao_social, pj.nome_fantasia, pj.cnpj,
  m.natureza_juridica_id, m.inscricao_estadual, m.inscricao_municipal, m.nire, m.data_registro_nire,
  m.registro_civil, m.data_registro_civil, m.cnae_principal, m.registro_ans, m.optante_simples, m.filantropica,
  m.incentivo_cultural, m.tipo_declarante_dmed, m.responsavel_pessoa_fisica_id, r.nome AS responsavel_nome,
  m.contador_pessoa_fisica_id, c.nome AS contador_nome, m.contador_crc, m.site,
  (SELECT COUNT(*) FROM estabelecimento e WHERE e.mantenedora_id = m.id AND e.excluido_em IS NULL) AS estabelecimentos`;
const DE_MANTENEDORA = `FROM mantenedora m JOIN pessoa_juridica pj ON pj.id = m.pessoa_juridica_id
  LEFT JOIN pessoa_fisica r ON r.id = m.responsavel_pessoa_fisica_id
  LEFT JOIN pessoa_fisica c ON c.id = m.contador_pessoa_fisica_id WHERE m.excluido_em IS NULL`;

const mantenedoraDe = (m: Record<string, unknown>) => ({
  id: Number(m['id']),
  versao: Number(m['versao']),
  codigo: String(m['codigo']),
  ativo: bool(m['ativo']),
  razaoSocial: String(m['razao_social']),
  nomeFantasia: texto(m['nome_fantasia']),
  cnpj: texto(m['cnpj']) ?? '',
  naturezaJuridica: num(m['natureza_juridica_id']),
  inscricaoEstadual: texto(m['inscricao_estadual']),
  inscricaoMunicipal: texto(m['inscricao_municipal']),
  nire: texto(m['nire']),
  dataRegistroNire: data(m['data_registro_nire']),
  registroCivil: texto(m['registro_civil']),
  dataRegistroCivil: data(m['data_registro_civil']),
  cnaePrincipal: texto(m['cnae_principal']),
  registroAns: texto(m['registro_ans']),
  optanteSimples: bool(m['optante_simples']),
  filantropica: bool(m['filantropica']),
  incentivoCultural: bool(m['incentivo_cultural']),
  tipoDeclarante: texto(m['tipo_declarante_dmed']),
  responsavel: num(m['responsavel_pessoa_fisica_id']),
  responsavelNome: texto(m['responsavel_nome']),
  contador: num(m['contador_pessoa_fisica_id']),
  contadorNome: texto(m['contador_nome']),
  contadorCrc: texto(m['contador_crc']),
  site: texto(m['site']),
  estabelecimentos: Number(m['estabelecimentos'] ?? 0),
});
export type MantenedoraLida = ReturnType<typeof mantenedoraDe>;

export class IdentidadeEstabelecimentoPropria {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoCadastro,
    private readonly cliente: string,
    executor?: Executor,
    /** Porta de arquivos (disco local, ADR 0004) para a imagem do logotipo; sem ela, o envio e a leitura dão 503. */
    private arquivos?: ArquivosDoModulo | null,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  /** A porta de arquivos do ambiente (ARQUIVOS_RAIZ), criada no primeiro uso. */
  private arquivosDe(c: ContextoPorta): ArquivosDoModulo {
    if (this.arquivos === undefined)
      this.arquivos = arquivosDoAmbiente(this.nucleo as unknown as NucleoArmazem, this.cliente);
    if (!this.arquivos || !c.hospital)
      throw new ErroOperacao(
        503,
        'indisponivel',
        'Indisponível',
        'O armazenamento de arquivos não está configurado.',
      );
    return this.arquivos;
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'cadastro' }, fn);
  }

  async estabelecimento(c: ContextoPorta): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const r = c.hospital
      ? await this.ler(c, (l) =>
          l.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
            c.hospital,
          ]),
        )
      : null;
    if (!r)
      throw new ErroOperacao(
        403,
        'sem-estabelecimento',
        'Sem estabelecimento',
        'A sessão não tem estabelecimento.',
      );
    return Number(r.id);
  }

  private async executar<E>(
    c: ContextoPorta,
    op: Parameters<Executor['executar']>[0],
    entrada: E,
    t: RegistroTrilhaTela,
  ) {
    const est = await this.estabelecimento(c);
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: t.usuario ?? c.usuario,
      correlacao: (t.correlacao ?? c.correlacao).slice(0, 64) || 'cadastro',
      chaveIdempotencia: `direta:${randomUUID()}`,
    };
    const x = await this.executor.executar(op, this.cliente, entrada, ctx);
    return x.resultado as { id: unknown; ids?: unknown };
  }

  /** Logotipos, mantenedora ligada, mantenedoras do cliente e as opções, numa leitura. */
  async lerTudo(c: ContextoPorta) {
    const est = await this.estabelecimento(c);
    return this.ler(c, async (l) => {
      const logos = await l.consultar(
        `SELECT g.id, g.versao, g.sequencia, g.finalidade, g.largura_px, g.altura_px, g.cabecalho_relatorio,
                g.rodape_relatorio, g.imprime_em_relatorio, g.ativo, g.criado_em, a.nome_original, a.tipo_mime,
                a.tamanho_bytes
           FROM logotipo_estabelecimento g JOIN arquivo a ON a.id = g.arquivo_id
          WHERE g.estabelecimento_id = ? AND g.excluido_em IS NULL ORDER BY g.ativo DESC, g.sequencia DESC`,
        [est],
      );
      const e = await l.uma('SELECT mantenedora_id FROM estabelecimento WHERE id = ?', [est]);
      const todas = (
        await l.consultar(`SELECT ${COLUNAS_MANTENEDORA} ${DE_MANTENEDORA} ORDER BY pj.razao_social`, [])
      ).map(mantenedoraDe);
      const naturezas = await l.consultar(
        'SELECT id, codigo_concla, descricao FROM natureza_juridica WHERE ativo ORDER BY descricao',
        [],
      );
      const ligada = num(e?.['mantenedora_id']);
      return {
        estabelecimento: est,
        logotipos: logos.map((g) => ({
          id: Number(g['id']),
          versao: Number(g['versao']),
          sequencia: Number(g['sequencia']),
          finalidade: String(g['finalidade']),
          largura: num(g['largura_px']),
          altura: num(g['altura_px']),
          cabecalhoRelatorio: texto(g['cabecalho_relatorio']),
          rodapeRelatorio: texto(g['rodape_relatorio']),
          imprimeEmRelatorio: bool(g['imprime_em_relatorio']),
          ativo: bool(g['ativo']),
          enviadoEm: data(g['criado_em']),
          nomeOriginal: String(g['nome_original']),
          tipoMime: String(g['tipo_mime']),
          tamanho: Number(g['tamanho_bytes']),
        })),
        mantenedora: todas.find((m) => m.id === ligada) ?? null,
        mantenedoras: todas,
        opcoes: {
          finalidades: [...FINALIDADES_LOGOTIPO],
          tiposDeclarante: [...TIPOS_DECLARANTE],
          naturezas: naturezas.map((n) => ({
            id: Number(n['id']),
            descricao: `${String(n['codigo_concla'])} · ${String(n['descricao'])}`,
          })),
        },
      };
    });
  }

  /** A pessoa pelo CPF inteiro (responsável legal e contador): só o id e o nome, nunca uma lista por nome. */
  pessoaPorCpf(c: ContextoPorta, cpf: string) {
    if (!/^\d{11}$/.test(cpf)) return Promise.resolve(null);
    return this.ler(c, async (l) => {
      const p = await l.uma('SELECT id, nome FROM pessoa_fisica WHERE cpf = ? AND excluido_em IS NULL', [
        cpf,
      ]);
      return p ? { id: Number(p['id']), nome: String(p['nome']) } : null;
    });
  }

  /** A imagem do logotipo do estabelecimento da sessão (conferida pelo hash na leitura). */
  async imagemLogotipo(c: ContextoPorta, id: number): Promise<{ tipo: string; conteudo: Buffer }> {
    const est = await this.estabelecimento(c);
    const g = await this.ler(c, (l) =>
      l.uma(
        'SELECT arquivo_id FROM logotipo_estabelecimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [id, est],
      ),
    );
    if (!g) throw naoAchado('Logotipo');
    const a = await this.arquivosDe(c).ler(c.hospital, Number(g['arquivo_id']));
    if (!a) throw naoAchado('Logotipo');
    return { tipo: a.metadado.tipoMime, conteudo: a.conteudo };
  }

  /**
   * Envio da imagem pela tela: confere o conteúdo e os dados antes de tocar o disco, guarda pela porta de arquivos
   * (o estabelecimento como dono) e inclui um logotipo por finalidade marcada, aposentando o ativo de cada uma.
   */
  async enviarLogotipo(c: ContextoPorta, e: EnvioLogotipo, t: RegistroTrilhaTela): Promise<number[]> {
    const finalidades = [...new Set(e.finalidades)];
    if (!finalidades.length) recusarErros(['finalidade-invalida']);
    recusarErros([
      ...errosArquivoLogotipo(e.conteudo),
      ...new Set(finalidades.flatMap((finalidade) => errosLogotipo({ ...e, finalidade }))),
    ]);
    const img = lerImagem(e.conteudo)!;
    const est = await this.estabelecimento(c);
    const arquivos = this.arquivosDe(c);
    const a = await arquivos.guardar(c.hospital, {
      conteudo: e.conteudo,
      nomeOriginal: e.nomeOriginal.slice(0, 255) || 'logotipo',
      tipoMime: img.tipo,
      finalidade: FINALIDADE_ARQUIVO_LOGOTIPO,
      entidade: 'estabelecimento',
      entidadeId: est,
    });
    try {
      const r = await this.executar(
        c,
        opIncluirLogotipo(t),
        {
          finalidades,
          arquivo: a.id,
          largura: img.largura,
          altura: img.altura,
          cabecalhoRelatorio: e.cabecalhoRelatorio,
          rodapeRelatorio: e.rodapeRelatorio,
          imprimeEmRelatorio: e.imprimeEmRelatorio,
        },
        t,
      );
      return String(r.ids ?? r.id)
        .split(',')
        .map(Number);
    } catch (erro) {
      // O arquivo novo sem logotipo não fica para trás (o reaproveitado é de outro logotipo: fica).
      if (!a.reaproveitado) await arquivos.excluir(c.hospital, a.id).catch(() => undefined);
      throw erro;
    }
  }

  async alterarLogotipo(c: ContextoPorta, e: EntradaAlterarLogotipo, t: RegistroTrilhaTela) {
    return Number((await this.executar(c, opAlterarLogotipo(t), e, t)).id);
  }
  async excluirLogotipo(c: ContextoPorta, e: EntradaExcluirLogotipo, t: RegistroTrilhaTela) {
    return Number((await this.executar(c, opExcluirLogotipo(t), e, t)).id);
  }
  async gravarMantenedora(c: ContextoPorta, e: EntradaMantenedora, t: RegistroTrilhaTela) {
    return Number((await this.executar(c, opGravarMantenedora(t), e, t)).id);
  }
  async ligarMantenedora(c: ContextoPorta, e: EntradaLigarMantenedora, t: RegistroTrilhaTela) {
    return Number((await this.executar(c, opLigarMantenedora(t), e, t)).id);
  }
  async situacaoMantenedora(c: ContextoPorta, e: EntradaSituacaoMantenedora, t: RegistroTrilhaTela) {
    return Number((await this.executar(c, opSituacaoMantenedora(t), e, t)).id);
  }
}
