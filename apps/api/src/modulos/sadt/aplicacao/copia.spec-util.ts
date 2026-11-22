// Massa SINTÉTICA comum dos testes de integração do SADT no MariaDB real (cliente f22_o2; nenhuma pessoa real): os
// estabelecimentos, o paciente, o atendimento e os profissionais vêm da massa da enfermagem (mesmo cliente da onda); o
// SADT acrescenta o setor de laboratório e de imagem, o catálogo (exame, analito, material, modalidade), a requisição
// com dois exames pedidos, o canal de comunicação, um resultado liberado com valor crítico e o aviso dele, e a
// numeração do laudo. `limparMassaSadt` apaga tudo o que montou (antes da massa da enfermagem). Saída só com contagens.
import { garantirSequencia, NucleoProprio } from '@sgh/nucleo';
import {
  CLIENTE,
  contextoDe,
  garantir,
  garantirCliente,
  limparMassa,
  type MassaEnfermagem,
  montarMassa,
  SEM_BANCO,
} from '../../enfermagem/massa-enfermagem.spec-util.js';
import type { TrilhaDaGravacao } from '../../exames/public-api.js';
import type { ContextoSadt } from '../porta.js';

export { CLIENTE, SEM_BANCO };

export interface MassaSadt {
  readonly base: MassaEnfermagem;
  readonly marca: string;
  readonly setorLab: number;
  readonly setorImagem: number;
  readonly exameLab: number;
  readonly exameLabCodigo: string;
  readonly exameImagem: number;
  readonly analito: number;
  readonly modalidade: number;
  readonly requisicao: number;
  readonly requisicaoImagem: number;
  /** exame_item do laboratório (a coletar) e de imagem (para a lista de trabalho). */
  readonly itemLab: number;
  readonly itemLab2: number;
  readonly itemImagem: number;
  /** Resultado liberado com valor crítico e o aviso pendente dele. */
  readonly itemLiberado: number;
  readonly resultado: number;
  readonly aviso: number;
  readonly canal: string;
}

export const contexto = (m: MassaSadt, est = m.base.est): ContextoSadt => ({
  ...contextoDe(m.base, est),
  rede: 'rede-teste',
  hospital: `h${m.marca.toLowerCase()}`.slice(0, 10),
});

/** A linha da trilha que a tela monta (como o apoio da gravação). */
export const linhaTela = (
  m: MassaSadt,
  evento: string,
  entidade: string,
  id: number | null,
): TrilhaDaGravacao => ({
  estabelecimento: m.base.est,
  usuario: m.base.usuario,
  acao: 'operacao',
  entidade,
  entidadeId: id,
  dadosDepois: { evento, recurso: 'teste', estacao: m.marca },
  correlacao: `t-${m.marca}`,
});

export async function montarMassaSadt(nucleo: NucleoProprio, prefixo: string): Promise<MassaSadt> {
  garantirCliente();
  // Marca por execução (3 letras do arquivo + 3 do relógio): uma execução interrompida não colide com a próxima.
  const marca = `${prefixo.slice(0, 3)}${Date.now().toString(36).slice(-3).toUpperCase()}`;
  const base = await montarMassa(nucleo, marca, false);
  const ctx = { cliente: CLIENTE, correlacao: `t-${marca}` };
  return nucleo
    .escrever(ctx, async (e) => {
      const agora = new Date();
      const ins = (sql: string, p: unknown[]) => e.inserir(sql, p);
      const fonte = Number(
        (
          await e.uma<{ f: number }>('SELECT fonte_pagadora_id AS f FROM atendimento WHERE id = ?', [
            base.atendimento,
          ])
        )?.f,
      );
      const setor = (tipo: string, cod: string) =>
        ins(
          `INSERT INTO setor_diagnostico (estabelecimento_id, codigo, nome, tipo, criado_em, versao)
         VALUES (?, ?, ?, ?, ?, 1)`,
          [base.est, `${marca}${cod}`, `SETOR ${cod} SINTETICO`, tipo, agora],
        );
      const setorLab = await setor('laboratorio', 'L');
      const setorImagem = await setor('imagem', 'I');
      const modalidade = await garantir(
        e,
        "SELECT id FROM modalidade_imagem WHERE codigo = 'CT'",
        [],
        "INSERT INTO modalidade_imagem (codigo, descricao, ativo, sigla_padrao, criado_em, versao) VALUES ('CT', 'Tomografia', TRUE, 'CT', ?, 1)",
        [agora],
      );
      const material = await garantir(
        e,
        "SELECT id FROM material_biologico WHERE codigo = 'SANGUE-T'",
        [],
        "INSERT INTO material_biologico (codigo, descricao, ativo, tipo, imprime_etiqueta_local, exige_sitio_anatomico, criado_em, versao) VALUES ('SANGUE-T', 'Sangue (teste)', TRUE, 'liquido', FALSE, FALSE, ?, 1)",
        [agora],
      );
      const exameLabCodigo = `${marca}K`;
      const exameLab = await ins(
        `INSERT INTO exame (codigo, sigla, nome, tipo_servico, tipo_resultado, ativo, criado_em, versao)
       VALUES (?, ?, 'POTASSIO SINTETICO', 'laboratorio', 'numerico', TRUE, ?, 1)`,
        [exameLabCodigo, `${marca}K`, agora],
      );
      const exameImagem = await ins(
        `INSERT INTO exame (codigo, sigla, nome, tipo_servico, tipo_resultado, modalidade_imagem_id, ativo, criado_em, versao)
       VALUES (?, ?, 'TOMOGRAFIA SINTETICA', 'imagem', 'laudo', ?, TRUE, ?, 1)`,
        [`${marca}T`, `${marca}T`, modalidade, agora],
      );
      await ins(
        'INSERT INTO exame_material (exame_id, material_biologico_id, padrao, criado_em, versao) VALUES (?, ?, TRUE, ?, 1)',
        [exameLab, material, agora],
      );
      const analito = await ins(
        `INSERT INTO analito (codigo, nome, tipo_resultado, ativo, criado_em, versao)
       VALUES (?, 'POTASSIO', 'numerico', TRUE, ?, 1)`,
        [`${marca}A`, agora],
      );
      await ins(
        'INSERT INTO exame_analito (exame_id, analito_id, ordem, criado_em, versao) VALUES (?, ?, 1, ?, 1)',
        [exameLab, analito, agora],
      );
      const requisicao = await ins(
        `INSERT INTO requisicao_exame (estabelecimento_id, numero, paciente_id, atendimento_id, setor_diagnostico_id,
         solicitante_profissional_id, fonte_pagadora_id, solicitado_em, criado_em, versao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          base.est,
          `${marca}-R1`,
          base.paciente,
          base.atendimento,
          setorLab,
          base.profissional,
          fonte,
          agora,
          agora,
        ],
      );
      const requisicaoImagem = await ins(
        `INSERT INTO requisicao_exame (estabelecimento_id, numero, paciente_id, atendimento_id, setor_diagnostico_id,
         solicitante_profissional_id, fonte_pagadora_id, solicitado_em, criado_em, versao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          base.est,
          `${marca}-R2`,
          base.paciente,
          base.atendimento,
          setorImagem,
          base.profissional,
          fonte,
          agora,
          agora,
        ],
      );
      const item = (req: number, seq: number, exame: number, situacao: string, extra = '') =>
        ins(
          `INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, material_biologico_id, situacao, criado_em, versao${extra ? ', liberado_em' : ''})
         VALUES (?, ?, ?, ?, ?, ?, 1${extra ? ', ?' : ''})`,
          [req, seq, exame, exame === exameLab ? material : null, situacao, agora, ...(extra ? [agora] : [])],
        );
      const itemLab = await item(requisicao, 1, exameLab, 'solicitado');
      const itemLab2 = await item(requisicao, 2, exameLab, 'solicitado');
      const itemLiberado = await item(requisicao, 3, exameLab, 'liberado', 'liberado');
      const itemImagem = await item(requisicaoImagem, 1, exameImagem, 'solicitado');
      const resultado = await ins(
        `INSERT INTO resultado_exame (exame_item_id, paciente_id, setor_diagnostico_id, forma_entrada, situacao, numero_versao,
         resultado_em, liberado_em, liberado_por_profissional_id, critico, criado_em, versao)
       VALUES (?, ?, ?, 'digitado', 'liberado', 1, ?, ?, ?, TRUE, ?, 1)`,
        [itemLiberado, base.paciente, setorLab, agora, agora, base.profissional, agora],
      );
      const ra = await ins(
        `INSERT INTO resultado_analito (resultado_exame_id, sequencia, analito_id, valor_numerico, critico, criado_em, versao)
       VALUES (?, 1, ?, 7.2, TRUE, ?, 1)`,
        [resultado, analito, agora],
      );
      const aviso = await ins(
        `INSERT INTO aviso_valor_critico (estabelecimento_id, resultado_exame_id, resultado_analito_id, paciente_id, gerado_em,
         prazo_em, situacao, criado_em, versao) VALUES (?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL 30 MINUTE), 'pendente', ?, 1)`,
        [base.est, resultado, ra, base.paciente, agora, agora, agora],
      );
      const canal = 'telefone-teste';
      await garantir(
        e,
        'SELECT id FROM canal_notificacao WHERE codigo = ?',
        [canal],
        "INSERT INTO canal_notificacao (codigo, descricao, ativo, tipo_canal, criado_em, versao) VALUES (?, 'Telefone (teste)', TRUE, 'central', ?, 1)",
        [canal, agora],
      );
      await garantir(
        e,
        "SELECT id FROM motivo_reimpressao WHERE codigo = 'perda-via'",
        [],
        "INSERT INTO motivo_reimpressao (codigo, descricao, ativo, criado_em, versao) VALUES ('perda-via', 'Paciente perdeu a primeira via', TRUE, ?, 1)",
        [agora],
      );
      await garantirSequencia(
        e,
        { tipo: 'laudo_exame', estabelecimento: base.est, prefixo: 'L' },
        { agora, usuario: null },
      );
      return {
        base,
        marca,
        setorLab,
        setorImagem,
        exameLab,
        exameLabCodigo,
        exameImagem,
        analito,
        modalidade,
        requisicao,
        requisicaoImagem,
        itemLab,
        itemLab2,
        itemImagem,
        itemLiberado,
        resultado,
        aviso,
        canal,
      };
    })
    .catch(async (x: unknown) => {
      await limparMassa(nucleo, base);
      throw x;
    });
}

export async function limparMassaSadt(nucleo: NucleoProprio, m: MassaSadt | null): Promise<void> {
  if (!m) return;
  await nucleo.escrever({ cliente: CLIENTE, correlacao: `t-${m.marca}` }, async (e) => {
    const ests = [m.base.est, m.base.outroEst];
    const emEst = 'estabelecimento_id IN (?, ?)';
    const itens = `(SELECT ei.id FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id WHERE r.${emEst})`;
    await e.executar(
      `UPDATE item_lista_trabalho_imagem SET integracao_mensagem_id = NULL, estudo_imagem_id = NULL WHERE ${emEst}`,
      ests,
    );
    await e.executar(
      `DELETE FROM integracao_mensagem WHERE entidade = 'item_lista_trabalho_imagem' AND entidade_id IN (SELECT id FROM item_lista_trabalho_imagem WHERE ${emEst})`,
      ests,
    );
    await e.executar(`DELETE FROM item_lista_trabalho_imagem WHERE ${emEst}`, ests);
    await e.executar(`DELETE FROM estudo_imagem WHERE ${emEst}`, ests);
    await e.executar(`DELETE FROM visualizador_imagem WHERE ${emEst}`, ests);
    await e.executar(
      `DELETE ex FROM emissao_laudo_exame ex JOIN emissao_laudo el ON el.id = ex.emissao_laudo_id WHERE el.${emEst}`,
      ests,
    );
    await e.executar(`DELETE FROM emissao_laudo WHERE ${emEst}`, ests);
    await e.executar(`DELETE FROM visualizacao_resultado_exame WHERE ${emEst}`, ests);
    await e.executar(
      `DELETE t FROM aviso_valor_critico_tentativa t JOIN aviso_valor_critico a ON a.id = t.aviso_valor_critico_id WHERE a.${emEst}`,
      ests,
    );
    await e.executar(`DELETE FROM aviso_valor_critico WHERE ${emEst}`, ests);
    await e.executar(`DELETE FROM regra_valor_critico WHERE ${emEst} OR exame_id IN (?, ?)`, [
      ...ests,
      m.exameLab,
      m.exameImagem,
    ]);
    await e.executar(
      `DELETE ev FROM amostra_biologica_evento ev JOIN amostra_biologica a ON a.id = ev.amostra_biologica_id WHERE a.${emEst}`,
      ests,
    );
    await e.executar(
      `DELETE x FROM amostra_biologica_exame x JOIN amostra_biologica a ON a.id = x.amostra_biologica_id WHERE a.${emEst}`,
      ests,
    );
    await e.executar(`DELETE FROM amostra_biologica WHERE ${emEst}`, ests);
    await e.executar(
      `DELETE FROM resultado_analito WHERE resultado_exame_id IN (SELECT id FROM resultado_exame WHERE exame_item_id IN ${itens})`,
      ests,
    );
    await e.executar(`DELETE FROM resultado_exame WHERE exame_item_id IN ${itens}`, ests);
    await e.executar(
      `DELETE ei FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id WHERE r.${emEst}`,
      ests,
    );
    await e.executar(`DELETE FROM requisicao_exame WHERE ${emEst}`, ests);
    await e.executar('DELETE FROM exame_analito WHERE exame_id IN (?, ?)', [m.exameLab, m.exameImagem]);
    await e.executar('DELETE FROM exame_material WHERE exame_id IN (?, ?)', [m.exameLab, m.exameImagem]);
    await e.executar('DELETE FROM exame WHERE id IN (?, ?)', [m.exameLab, m.exameImagem]);
    await e.executar('DELETE FROM analito WHERE id = ?', [m.analito]);
    await e.executar(`DELETE FROM setor_diagnostico WHERE ${emEst}`, ests);
    await e.executar(`DELETE FROM sequencia_negocio WHERE tipo = 'laudo_exame' AND ${emEst}`, ests);
  });
  await limparMassa(nucleo, m.base);
}
