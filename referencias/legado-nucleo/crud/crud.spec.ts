// CRUD genérico (M08): declaração → Zod, codec das colunas, receita genérica (incluir, alterar, inativar) e
// leituras, sobre um banco em memória (dublê; dados sintéticos). A integração na cópia fica em
// packages/testes/src/integracao/inativar.int.spec.ts e dominios.int.spec.ts.
import { describe, expect, it } from 'vitest';
import { declaracao, DECLARACOES, OPERACOES_DOMINIOS } from '../../cadastros.js';
import type { Linha } from '../driver.js';
import { type Comando, escritorDuble } from '../duble-escritor.spec-util.js';
import { ErroOperacao, ErroProva } from '../erros-operacao.js';
import { txDaOperacao } from '../executor.js';
import type { ContextoOperacao } from '../operacao.js';
import {
  camposDescritos,
  chaveDoCodigo,
  colunaDoCampo,
  declararCadastroLegado,
  esquemaAlteracao,
  esquemaInclusao,
  itemDaLinha,
  temDadoPessoal,
  valorDaColuna,
  valorParaColuna,
} from './declaracao.js';
import {
  clausulaEscopo,
  ErroEscopo,
  itemDoDominio,
  listarDominio,
  opcoesDoCampo,
  referenciasDaTabela,
  usoDoItem,
} from './repositorio.js';
import { operacoesDoDominio, versaoDaLinha } from '../gravacao/receita-generica.js';

const ctx: ContextoOperacao = {
  rede: 'rede-teste',
  hospital: 'pc',
  traceId: 'teste',
  usuarioLegado: 'SGH.TESTE',
  idempotencyKey: 'chave-teste-0001',
};

/** Banco em memória: uma tabela de domínio, FKs e uso (respostas para o SQL que o CRUD genérico monta). */
function banco(
  tabelas: Record<string, { chave: string; linhas: Linha[]; gerador?: number }>,
  usos: Record<string, boolean> = {},
) {
  return (c: Comando): Linha[] | number => {
    const sql = c.sql.replace(/\s+/g, ' ').trim();
    if (sql.includes('RDB$RELATION_CONSTRAINTS')) {
      return [
        { FILHA: 'TBFILHA', COLUNA: 'ID_DOMINIO', REGRA: 'RESTRICT', SEGMENTOS: 1 },
        { FILHA: 'TBCOMPOSTA', COLUNA: 'A', REGRA: 'CASCADE', SEGMENTOS: 2 },
      ];
    }
    let m = /^SELECT FIRST 1 1 U FROM (\w+) WHERE (\w+) = \?$/.exec(sql);
    if (m) return usos[String(c.parametros[0])] ? [{ U: 1 }] : [];
    m = /^SELECT FIRST 501 (\w+) V, (\w+) R FROM (\w+) ORDER BY \w+$/.exec(sql);
    if (m) {
      const t = tabelas[m[3] ?? ''];
      return (t?.linhas ?? []).map((l) => ({ V: l[m![1]!], R: l[m![2]!] }));
    }
    m = /^SELECT (?:FIRST 501 )?(.+?) FROM (\w+)(?: WHERE (.+?))?(?: ORDER BY \w+)?(?: WITH LOCK)?$/.exec(
      sql,
    );
    if (m) {
      const t = tabelas[m[2] ?? ''];
      if (!t) return [];
      let linhas = t.linhas;
      if (m[3]?.startsWith(`${t.chave} = ?`)) linhas = linhas.filter((l) => l[t.chave] === c.parametros[0]);
      return linhas.map((l) => ({ ...l }));
    }
    m = /^INSERT INTO (\w+) \(([^)]*)\) VALUES \(([^)]*)\)(?: RETURNING (\w+))?$/.exec(sql);
    if (m) {
      const t = tabelas[m[1] ?? '']!;
      const cols = (m[2] ?? '').split(', ');
      const l: Linha = Object.fromEntries(cols.map((k, i) => [k, c.parametros[i]]));
      if (l[t.chave] === undefined || l[t.chave] === null) l[t.chave] = t.gerador = (t.gerador ?? 100) + 1;
      t.linhas.push(l);
      return m[4] ? [{ [m[4]]: l[m[4]] }] : 1;
    }
    m = /^UPDATE (\w+) SET (.+) WHERE (\w+) = \?$/.exec(sql);
    if (m) {
      const t = tabelas[m[1] ?? '']!;
      const sets = (m[2] ?? '').split(', ').map((x) => x.split(' = ')[0] ?? '');
      const chave = c.parametros[sets.length];
      const l = t.linhas.find((x) => x[t.chave] === chave);
      if (!l) return 0;
      sets.forEach((s, i) => (l[s] = c.parametros[i]));
      return 1;
    }
    return [];
  };
}

const op = (nome: string) => {
  const o = OPERACOES_DOMINIOS.find((x) => x.receita.nome === nome);
  if (!o) throw new Error(nome);
  return o;
};

describe('declarações do lote-piloto (20 domínios), do M11 (4), do M12 (4), do M10 (20), do M13 (4), do M14 (176), do M18 (3), do M24 (31), do M20 (8), do M26 (8), do M21 (10), do M25 (2), do M34 (10) e do M32 (26), do M33 (13) e do M49 (7), do M56 (63) e do M50 (6 da etapa 5 e 2 da etapa 6) e do M51 (2) e do M53 (8) e do M48 (3) e do M54 (14)', () => {
  it('462 declarações (20 do M08, 4 do M11, 4 do M12, 20 do M10, 4 do M13, 176 do lote do M14, 6 do M23, 5 do M19, 3 do M18, 31 do M24, 8 do M20, 8 do M26, 10 do M21, 2 do M25, 10 do M34, 26 do M32, 13 do M33, 7 do M49, 63 do M56, 8 do M50: 6 da etapa 5 e 2 da etapa 6, e 7 do M47.2 e 2 do M51: FAMEDSOL e FHLEITOUTI, e 8 do M53.2: rubricas, incidências e tabelas legais da folha, e 3 do M48.5: autoridades sanitárias e eixos e graus da matriz GUT, e 5 do M54.4: cadastros da estrutura de custos, e 9 do M54.1: as migrar-crud da contabilidade e do patrimônio); os de sistema só consulta', () => {
    // M23: mais os 6 cadastros de dieta (5 editáveis; o tipo de dieta é de sistema). M24: mais os 3 cadastros de
    // prescrição (2 editáveis; o hemocomponente prescritível é travado) e os 28 da P-CAD-1 (frequências, kits,
    // não padronizados, parâmetros do item, protocolos, receitas padrão, interações e horários-padrão).
    expect(DECLARACOES).toHaveLength(462);
    // M54: 14 das 15 migrar-crud da controladoria nos grupos contabil, custos e patrimonio (as 5 de custos da etapa 4, as
    // 9 de contabil e patrimonio da etapa F1) (o grupo é o módulo
    // das permissões; os parâmetros do orçamento, sem chave primária, seguem na consulta do M14, D-MOPARAM-541); de
    // sistema, o tipo de solicitação de senha (o gatilho recusa), o NIRE por estado (D-NIRE-541) e o parâmetro por
    // usuário (D-GPPARAMU-541).
    const doM54 = DECLARACOES.filter((d) => d.publico.marco === 'M54');
    expect(
      doM54
        .map((d) => [d.tabela, d.grupo, d.publico.natureza])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ['CONIRE', 'contabil', 'sistema'],
      ['COPERIODESCRIT', 'contabil', 'editavel'],
      ['COTIPOSOLICITACAOSENHA', 'contabil', 'sistema'],
      ['COTP_ORIGEM_LANCAMENTO', 'contabil', 'editavel'],
      ['CTCTARECEITANCI', 'custos', 'editavel'],
      ['CTTIPODADO', 'custos', 'editavel'],
      ['CTWGRUPOEXPORTACAO', 'custos', 'editavel'],
      ['CTWTPREGRA', 'custos', 'editavel'],
      ['GPCOEFICIENTE_DEPREC', 'patrimonio', 'editavel'],
      ['GPORIGEM', 'patrimonio', 'editavel'],
      ['GPPARAMG', 'patrimonio', 'editavel'],
      ['GPPARAMU', 'patrimonio', 'sistema'],
      ['GPTP_RESPONSAVEL', 'patrimonio', 'editavel'],
      ['TBUNIMEN', 'custos', 'editavel'],
    ]);
    expect(doM54.every((d) => d.grupo === d.publico.modulo)).toBe(true);
    expect(DECLARACOES.some((d) => d.tabela === 'MOPARAM')).toBe(false);
    // D-GPPARAMG-541: os parâmetros gerais do patrimônio só se alteram (uma linha por empresa, já criada).
    const gpparamg = doM54.find((d) => d.tabela === 'GPPARAMG')!;
    expect(gpparamg.publico.acoes).not.toContain('criar');
    expect(gpparamg.publico.semInclusao).toMatch(/só se alteram/);
    // D-GPORIGEM-541: as origens do bem também só se alteram; a integração com o financeiro fica só leitura.
    const gporigem = doM54.find((d) => d.tabela === 'GPORIGEM')!;
    expect(gporigem.publico.acoes).not.toContain('criar');
    expect(gporigem.colunas.find((c) => c.coluna === 'INTEGRAR_FINANCEIRO')).toMatchObject({
      editavel: false,
      naInclusao: false,
    });
    expect(
      OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M54')
        .map((o) => o.receita.nome)
        .sort(),
    ).toHaveLength(17);
    // M48 (etapa 5): as autoridades sanitárias e a escala GUT do outro sistema, editáveis, com a chave digitada (sem
    // generator), cada uma com a chave da funcionalidade e os perfis do novo.
    const doM48 = DECLARACOES.filter((d) => d.publico.marco === 'M48');
    expect(doM48.map((d) => [d.tabela, d.chave, d.publico.chaveRecurso])).toEqual([
      ['TBTPAUTORIDADE', 'ID', 'qualidade.agravos'],
      ['RPMATRIZ_GUT_TIPO', 'ID', 'qualidade.gestao'],
      ['RPMATRIZ_GUT_DESCRICAO', 'ID', 'qualidade.gestao'],
    ]);
    expect(doM48.every((d) => d.grupo === 'qualidade' && d.publico.natureza === 'editavel')).toBe(true);
    // M53 (etapa F1): as 8 migrar-crud da folha que ainda não eram cadastro, no grupo `pessoas`: a rotina de integração
    // é de sistema (o gatilho recusa); rubricas e incidências gravam só com a chave `pessoas.folha`; todas pedem também a
    // `pessoas.rubrica.editar` (a permissão da tela); a rubrica não se inclui pelo cadastro (as fórmulas em texto longo
    // vêm preenchidas); a tabela legal tem a chave do tipo data.
    const doM53 = DECLARACOES.filter((d) => d.publico.marco === 'M53');
    expect(doM53.map((d) => [d.tabela, d.publico.natureza])).toEqual([
      ['FPEVENTO', 'editavel'],
      ['FPINTROTINA', 'sistema'],
      ['FPRUBRICAFGTS_FPEVENTO', 'editavel'],
      ['FPRUBRICAINSS_FPEVENTO', 'editavel'],
      ['FPRUBRICAIRRF_FPEVENTO', 'editavel'],
      ['FPRUBRICASIND_FPEVENTO', 'editavel'],
      ['FPTPEVENTOAUT_TBEMPHOS', 'editavel'],
      ['TBTABIRR', 'editavel'],
    ]);
    expect(doM53.every((d) => d.grupo === 'pessoas' && d.publico.modulo === 'pessoas')).toBe(true);
    for (const d of doM53.filter((x) => x.publico.natureza === 'editavel'))
      expect(d.publico.permissaoGravacaoGrupo, d.tabela).toBe('pessoas.rubrica.editar');
    expect(
      doM53.filter((d) => d.publico.chaveRecurso === 'pessoas.folha').map((d) => d.tabela),
    ).not.toContain('TBTABIRR');
    expect(doM53.find((d) => d.tabela === 'FPEVENTO')?.publico.acoes).not.toContain('criar');
    expect(
      doM53.find((d) => d.tabela === 'TBTABIRR')?.colunas.find((c) => c.coluna === 'DTA_INSS_IRRF')?.tipo,
    ).toBe('data');
    // M47 (etapa 2): os 7 cadastros editáveis da agência transfusional (só com a agência própria, `agencia.completa`).
    expect(DECLARACOES.filter((d) => d.publico.marco === 'M47').map((d) => d.tabela)).toEqual([
      'SHCLIENT',
      'SHCONDUTA',
      'SHESTFINAL',
      'SHINTER',
      'SHLOCAL',
      'SHMOTDEV',
      'SHREACAO',
    ]);
    expect(
      DECLARACOES.filter((d) => d.publico.marco === 'M47').every(
        (d) => d.publico.chaveRecurso === 'agencia.completa' && d.publico.natureza === 'editavel',
      ),
    ).toBe(true);
    // M51 (etapa 2): os médicos solicitantes SUS (FAMEDSOL), editável, com o CPF digitado como chave; (etapa 4) os
    // leitos de UTI habilitados (FHLEITOUTI), com o ID do gerador.
    expect(DECLARACOES.filter((d) => d.publico.marco === 'M51').map((d) => [d.tabela, d.chave])).toEqual([
      ['FAMEDSOL', 'CPF'],
      ['FHLEITOUTI', 'ID'],
    ]);
    // M50 (etapa 5): os 6 domínios do controle de acesso (2 editáveis, 1 travado, 3 de sistema).
    // M50 (etapa 6): as agendas de sessões e as cadeiras e salas (editáveis; a inativação só no novo).
    const doM50 = DECLARACOES.filter((d) => d.publico.marco === 'M50');
    expect(doM50.map((d) => [d.tabela, d.publico.natureza])).toEqual([
      ['CVTPVISITANTE', 'editavel'],
      ['CVTPVISITADO', 'editavel'],
      ['CVTPIDENTIFIC', 'travado'],
      ['CVTPSITACESSO', 'sistema'],
      ['CVTERMINALFAB', 'sistema'],
      ['CVTPTERMINAL', 'sistema'],
      ['AGCADAGENDA', 'editavel'],
      ['AGCADEIRA', 'editavel'],
    ]);
    // M56 (etapa F0): as 63 migrar-crud da operadora própria no grupo `operadora` (40 de sistema, 7 travadas, 16
    // editáveis; os dias de vencimento e as mensagens de cobrança sem inclusão), concedidas aos perfis da operadora.
    const doM56 = DECLARACOES.filter((d) => d.publico.marco === 'M56');
    expect(doM56).toHaveLength(63);
    expect(doM56.every((d) => d.grupo === 'operadora' && d.publico.modulo === 'operadora')).toBe(true);
    const natM56: Record<string, number> = {};
    for (const d of doM56) natM56[d.publico.natureza] = (natM56[d.publico.natureza] ?? 0) + 1;
    expect(natM56).toEqual({ sistema: 40, travado: 7, editavel: 16 });
    expect(doM56.every((d) => d.publico.perfis?.gravar.join() === 'operadora-gestor')).toBe(true);
    for (const d of doM56.filter((x) => x.publico.natureza !== 'editavel'))
      expect(d.publico.acoes, d.tabela).toEqual(['ler', 'exportar']);
    expect(
      doM56
        .filter((d) => d.publico.natureza === 'editavel' && !d.publico.acoes.includes('criar'))
        .map((d) => d.tabela),
    ).toEqual(['CDDIAVENCCOB', 'CDMSGCOBRANCA']);
    expect(doM56.find((d) => d.tabela === 'CDMSGCOBRANCA')?.pendenteDeProva?.verbos).toEqual(['alterar']);
    // M49 (etapa 3): os 7 cadastros da assinatura digital, todos editáveis; só o OID ganha inclusão (sem trigger nem
    // generator: o código é digitado).
    const doM49 = DECLARACOES.filter((d) => d.publico.marco === 'M49');
    expect(doM49.map((d) => d.tabela)).toEqual([
      'TBOID',
      'TBTIPOOID',
      'TBTIPOCERTIFICADO',
      'TBSAFEWEB_FORMA_ASSIN_ICP',
      'TBVIDAAS_FORMA_ASSIN_ICP',
      'TBSAFEWEB_SITAUTORIZA',
      'TBSAFEWEB_TIPOATENDIMENTO',
    ]);
    expect(doM49.filter((d) => d.publico.acoes.includes('criar')).map((d) => d.tabela)).toEqual(['TBOID']);
    expect(doM49.every((d) => d.triggers.length === 0 && d.publico.natureza === 'editavel')).toBe(true);
    // M33: os 13 cadastros do repasse (11 editáveis, 2 de carga de referência); a cooperativa sem dados bancários.
    const doM33 = DECLARACOES.filter((d) => d.publico.marco === 'M33');
    expect(doM33).toHaveLength(13);
    expect(doM33.filter((d) => d.publico.natureza === 'carga-referencia').map((d) => d.tabela)).toEqual([
      'RPRENDISENTO',
      'RPDEDUTIVEL',
    ]);
    expect(doM33.find((d) => d.tabela === 'TBCOOPER')?.colunas.map((c) => c.coluna)).not.toContain('CONTA');
    // M32: os 26 cadastros e parâmetros financeiros (migrar-crud da matriz), 4 de sistema (só consulta).
    const doM32 = DECLARACOES.filter((d) => d.publico.marco === 'M32');
    expect(doM32).toHaveLength(26);
    expect(doM32.filter((d) => d.publico.natureza === 'sistema').map((d) => d.tabela)).toEqual([
      'MFTIPOLANC',
      'MFTPCONTRIBUICAO',
      'MFTPAPURACAO',
      'TBTPOCORBANCOPGTO',
    ]);
    // Nenhuma coluna de credencial bancária no cadastro de bancos (cap-12 §12.3).
    expect(doM32.find((d) => d.tabela === 'TBBANCOS')?.colunas.map((c) => c.coluna)).not.toContain(
      'CODCEDENTE',
    );
    // M25: os procedimentos e cuidados de enfermagem e os kits por procedimento.
    expect(DECLARACOES.filter((d) => d.publico.marco === 'M25').map((d) => d.tabela)).toEqual([
      'TBPROENF',
      'TBKITPRO',
    ]);
    // M34: o de-para do laboratório de apoio e das interfaces, os domínios das mensagens, da classificação externa
    // (de sistema) e dos webservices.
    expect(DECLARACOES.filter((d) => d.publico.marco === 'M34').map((d) => d.tabela)).toEqual([
      'SITBEXHP',
      'SITBELHP',
      'SIMATHP',
      'SITBEXEQ',
      'TBSMSTPERRO',
      'TBSMSTPAGENDA',
      'TBSMSTPRETMSG',
      'RETPPROTOLIFE',
      'TBOPERSCHEMA',
      'TBTPWEBSERV',
    ]);
    expect(DECLARACOES.filter((d) => d.publico.marco === 'M24')).toHaveLength(31);
    // M20: as fichas a imprimir (modelo, título e as 4 seleções) e os leitos de observação (local e leito).
    expect(DECLARACOES.filter((d) => d.publico.marco === 'M20').map((d) => d.tabela)).toEqual([
      'REMODFIC',
      'RETITFIC',
      'RECONFIC',
      'REESPFIC',
      'REUNIFIC',
      'REGRPFIC',
      'RELOCLEITO',
      'RELEITO',
    ]);
    expect(DECLARACOES.filter((d) => d.publico.marco === 'M18').map((d) => d.tabela)).toEqual([
      'SIAGENDA',
      'SICTRAGE',
      'CCSALAS',
    ]);
    expect(DECLARACOES.filter((d) => d.publico.marco === 'M23')).toHaveLength(6);
    // M21: as fichas da internação (modelo e título), os cadastros da higienização e os do SAME.
    expect(DECLARACOES.filter((d) => d.publico.marco === 'M21').map((d) => d.tabela)).toEqual([
      'RIMODFIC',
      'RITITFIC',
      'CHAREA',
      'CHPROFISLIMP',
      'CHPROFLIMPTEL',
      'CHAREA_CHPROFISLIMP',
      'TBLEITO_CHPROFISLIMP',
      'CHTPLIMPEZA_GEITENS',
      'RISETOR',
      'GDPRONTCADOPER',
    ]);
    // M19: recepções, geradores, painéis de chamada, tipos de painel (travado) e painéis de TV de setores; W1-04: a
    // procedência (saiu do lote do M14 para o prefixo da recepção).
    expect(DECLARACOES.filter((d) => d.publico.marco === 'M19').map((d) => d.tabela)).toEqual([
      'TBPROCED',
      'TBRECEPCAO',
      'TBGERASENHA',
      'PNCONFIG',
      'PNTIPO',
      'PNCONFIGPORTAL',
    ]);
    expect(DECLARACOES.filter((d) => d.publico.marco === 'M14')).toHaveLength(175);
    expect(
      // O M56 confere os seus 40 de sistema à parte (bloco do M56 acima).
      DECLARACOES.filter(
        (d) =>
          d.publico.natureza === 'sistema' &&
          d.publico.marco !== 'M14' &&
          d.publico.marco !== 'M56' &&
          d.publico.marco !== 'M50' &&
          // O M53 confere o seu de sistema (a rotina de integração da folha) no bloco do M53 acima.
          d.publico.marco !== 'M53' &&
          // O M54 confere os seus 3 de sistema no bloco do M54 acima.
          d.publico.marco !== 'M54',
      )
        .map((d) => d.tabela)
        .sort(),
    ).toEqual([
      // M21: as operações do arquivo (o gatilho recusa toda gravação).
      'GDPRONTCADOPER',
      // M32: os tipos de lançamento, de contribuição e de apuração (o gatilho *_BIUD recusa toda gravação).
      'MFTIPOLANC',
      'MFTPAPURACAO',
      'MFTPCONTRIBUICAO',
      'RETPPROTOLIFE',
      'TBALTARN',
      'TBCLASSIFALERGIA',
      'TBDESFECHO_INTERNACAO',
      'TBLGPDANONMOT',
      'TBLGPDANONUSERFUNCAO',
      'TBMOVTERMSTATUS',
      'TBREFERENCIA',
      'TBTABELA_CAMPO',
      'TBTERMCONREVTP',
      'TBTIPOACOMOD',
      'TBTIPOREPRE',
      'TBTPDIETA',
      'TBTPEMP',
      'TBTPINTMED',
      // M32: as ocorrências bancárias da remessa (dado do fornecedor).
      'TBTPOCORBANCOPGTO',
    ]);
    // M10: 9 editáveis da estrutura (unidade, centro de custo, clínica, bloco, local sem inclusão, feriado,
    // prioridade, local de conta, unidade de consumo) = 20 operações (unidade e centro de custo sem inclusão; unidade de consumo sem inativação); os oficiais e os de sistema só consultam.
    expect(
      DECLARACOES.filter((d) => d.publico.marco === 'M10' && d.publico.natureza === 'editavel'),
    ).toHaveLength(9);
    // M11: conselho (incluir, alterar), especialidade e CBO da especialidade (alterar), prestador (alterar,
    // inativar): sem inclusão onde o legado não comporta (semInclusao). M12: as 8 das classificações oncológicas.
    // M13: as 8 dos mapeamentos dos catálogos e das seções do leiaute de CEP.
    // M23: as 12 dos cadastros de dieta. M24: as 5 dos locais de assistência e das perguntas à operadora. M19: alterar
    // recepção; incluir, alterar e inativar gerador; alterar painel de chamada e painel de TV.
    // W1-04: as três da procedência na lista do M19 (reativar e excluir ficam no conjunto à parte do motor).
    expect(OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M19').map((o) => o.receita.nome)).toEqual([
      'recepcao.incluirProcedencia',
      'recepcao.alterarProcedencia',
      'recepcao.inativarProcedencia',
      // W1-04 (parte 3): a inclusão da recepção com o texto da senha.
      'recepcao.incluirRecepcao',
      'recepcao.alterarRecepcao',
      'recepcao.incluirGerador',
      'recepcao.alterarGerador',
      'recepcao.inativarGerador',
      // W1-04 (parte 4): a inclusão do painel de chamada e do painel de TV com o leiaute padrão.
      'recepcao.incluirPainel',
      'recepcao.alterarPainel',
      'relatorio.incluirPainel',
      'relatorio.alterarPainel',
    ]);
    expect(
      OPERACOES_DOMINIOS.filter(
        (o) =>
          o.receita.marco !== 'M14' &&
          o.receita.marco !== 'M19' &&
          o.receita.marco !== 'M18' &&
          o.receita.marco !== 'M20' &&
          o.receita.marco !== 'M26' &&
          o.receita.marco !== 'M21' &&
          o.receita.marco !== 'M25' &&
          o.receita.marco !== 'M34' &&
          o.receita.marco !== 'M32' &&
          o.receita.marco !== 'M33' &&
          o.receita.marco !== 'M49' &&
          o.receita.marco !== 'M56' &&
          o.receita.marco !== 'M50' &&
          o.receita.marco !== 'M47' &&
          o.receita.marco !== 'M51' &&
          o.receita.marco !== 'M53' &&
          o.receita.marco !== 'M48' &&
          o.receita.marco !== 'M54' &&
          o.receita.marco !== 'W0-02',
      ),
    ).toHaveLength(134);
    // W0-02: a reativação pela coluna de situação, uma para cada inativação do cadastro anterior (mesmo domínio).
    const inativar = OPERACOES_DOMINIOS.filter((o) => /\.inativar[A-Z]/.test(o.receita.nome)).map((o) =>
      o.receita.nome.replace('.inativar', '.'),
    );
    const reativar = OPERACOES_DOMINIOS.filter((o) => /\.reativar[A-Z]/.test(o.receita.nome)).map((o) =>
      o.receita.nome.replace('.reativar', '.'),
    );
    expect(reativar).toEqual(inativar);
    // W0-02 (rodada 2): mais a exclusão dos dois pilotos do catálogo (característica de dieta e a ligação com a dieta).
    const excluir = OPERACOES_DOMINIOS.filter((o) => /\.excluir[A-Z]/.test(o.receita.nome)).map(
      (o) => o.receita.nome,
    );
    // W1-04: o motivo de exclusão e a procedência (mapa de dependências da recepção).
    expect(excluir).toEqual([
      'recepcao.excluirMotivoExclusao',
      'recepcao.excluirProcedencia',
      'pep.excluirCaracteristicaDieta',
      'pep.excluirCaracteristicaDaDieta',
      // W1-04 (parte 3): a recepção (declarada no M19, depois dos pilotos).
      'recepcao.excluirRecepcao',
      // W1-04 (parte 4): o painel de chamada e o painel de TV.
      'recepcao.excluirPainel',
      'relatorio.excluirPainel',
      // W1-05: o modelo e o título da ficha a imprimir, as quatro seleções do modelo e o local de observação.
      'atendimento.excluirModeloFicha',
      'atendimento.excluirTituloFicha',
      'atendimento.excluirFichaConvenio',
      'atendimento.excluirFichaEspecialidade',
      'atendimento.excluirFichaUnidade',
      'atendimento.excluirFichaGrupo',
      'atendimento.excluirLocalObservacao',
    ]);
    expect(OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'W0-02').length).toBe(
      reativar.length + excluir.length,
    );
    // M54 (etapa 4): incluir e alterar as contas de receita e as unidades de mensuração; só alterar o nome dos grupos
    // de exportação, dos tipos de dado e dos tipos de regra de rateio (as regras do custeio leem o código).
    expect(
      OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M54' && o.receita.nome.startsWith('custos.'))
        .map((o) => o.receita.nome)
        .sort(),
    ).toEqual([
      'custos.alterarContaReceita',
      'custos.alterarGrupoExportacao',
      'custos.alterarTipoDado',
      'custos.alterarTipoRegraRateio',
      'custos.alterarUnidadeMensuracao',
      'custos.incluirContaReceita',
      'custos.incluirUnidadeMensuracao',
    ]);
    // M48 (etapa 5): incluir e alterar as autoridades sanitárias; só alterar os eixos e graus da escala GUT (fixa, sem
    // inclusão; D-GUT-FIXA-48.5); nenhuma inativação (sem coluna de situação).
    expect(
      OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M48')
        .map((o) => o.receita.nome)
        .sort(),
    ).toEqual([
      'qualidade.alterarAutoridadeSanitaria',
      'qualidade.alterarGutGrau',
      'qualidade.alterarGutTipo',
      'qualidade.incluirAutoridadeSanitaria',
    ]);
    // M53 (etapa F1): alterar a rubrica (sem inclusão), incluir e alterar os quatro vínculos de incidência e a tabela
    // legal, incluir o lançamento automático da empresa (sem inativação no outro sistema: nenhuma tem situação gravável).
    expect(
      OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M53')
        .map((o) => o.receita.nome)
        .sort(),
    ).toEqual([
      'pessoas.alterarRubrica',
      'pessoas.alterarRubricaIncidenciaFgts',
      'pessoas.alterarRubricaIncidenciaInss',
      'pessoas.alterarRubricaIncidenciaIrrf',
      'pessoas.alterarRubricaIncidenciaSindical',
      'pessoas.alterarTabelaLegalFolha',
      'pessoas.incluirEventoAutomaticoEmpresa',
      'pessoas.incluirRubricaIncidenciaFgts',
      'pessoas.incluirRubricaIncidenciaInss',
      'pessoas.incluirRubricaIncidenciaIrrf',
      'pessoas.incluirRubricaIncidenciaSindical',
      'pessoas.incluirTabelaLegalFolha',
    ]);
    // M53.2: a alteração da rubrica foi provada com o carimbo do gatilho da própria rubrica (carimbosNaAlteracao).
    const rubrica = OPERACOES_DOMINIOS.find((o) => o.receita.nome === 'pessoas.alterarRubrica')!.receita;
    expect(rubrica.pendente).toBeUndefined();
    expect(
      rubrica.cenarios[0]?.referencia?.classes?.['FPEVENTO']?.['DATA_HORA_INC_ULT_ALT_ESOC']?.classe,
    ).toBe('carimbo-banco');
    // M51 (etapa 2): incluir e alterar o médico solicitante SUS (FAMEDSOL; sem inativação: a tabela não tem situação).
    expect(OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M51').map((o) => o.receita.nome)).toEqual([
      'faturamento.incluirSusSolicitante',
      'faturamento.alterarSusSolicitante',
      // M51 (etapa 4): incluir e alterar o leito de UTI habilitado (FHLEITOUTI; sem inativação: zerar os leitos).
      'faturamento.incluirSusLeitoUti',
      'faturamento.alterarSusLeitoUti',
    ]);
    // M50 (etapa 5): incluir, alterar e inativar o tipo de visitante; incluir e alterar o tipo de visitado.
    // M50 (etapa 6): incluir e alterar das agendas de sessões e das cadeiras e salas.
    expect(OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M50')).toHaveLength(9);
    expect(
      OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M50' && o.receita.nome.startsWith('agenda.')).map(
        (o) => o.receita.nome,
      ),
    ).toEqual([
      'agenda.incluirAgendaSessao',
      'agenda.alterarAgendaSessao',
      'agenda.incluirRecursoSessao',
      'agenda.alterarRecursoSessao',
    ]);
    // M47 (etapa 2): incluir e alterar dos 7 cadastros da agência transfusional.
    expect(OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M47')).toHaveLength(14);
    // M56 (etapa 1): incluir e alterar dos 16 editáveis da operadora própria (14 incluir, 16 alterar).
    expect(OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M56')).toHaveLength(30);
    // M49 (etapa 3): incluir o OID e alterar os sete cadastros da assinatura digital.
    expect(OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M49').map((o) => o.receita.nome)).toEqual([
      'documento.incluirOidIcp',
      'documento.alterarOidIcp',
      'documento.alterarTipoOid',
      'documento.alterarTipoCertificado',
      'documento.alterarFormaAssinaturaSafeweb',
      'documento.alterarFormaAssinaturaVidaas',
      'documento.alterarSituacaoAutorizacaoSafeweb',
      'documento.alterarTipoAtendimentoSafeweb',
    ]);
    // M32: 44 operações (incluir, alterar e inativar dos 22 cadastros editáveis, conforme as ações de cada um).
    expect(OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M32')).toHaveLength(44);
    // M25: procedimentos (incluir, alterar, inativar) e kits (incluir, alterar) de enfermagem.
    expect(OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M25').map((o) => o.receita.nome)).toEqual([
      'enfermagem.incluirProcedimento',
      'enfermagem.alterarProcedimento',
      'enfermagem.inativarProcedimento',
      'enfermagem.incluirKitProcedimento',
      'enfermagem.alterarKitProcedimento',
    ]);
    // M34: incluir e alterar o de-para do laboratório de apoio (exames, elementos, materiais) e das interfaces, os
    // domínios das mensagens e dos webservices; os perfis de prioridade da classificação externa são de sistema.
    expect(OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M34').map((o) => o.receita.nome)).toEqual([
      'sadt.incluirApoioExame',
      'sadt.alterarApoioExame',
      'sadt.incluirApoioElemento',
      'sadt.alterarApoioElemento',
      'sadt.incluirApoioMaterial',
      'sadt.alterarApoioMaterial',
      'sadt.incluirDeParaEquipamento',
      'sadt.alterarDeParaEquipamento',
      'integracao.incluirTipoErroMensagem',
      'integracao.alterarTipoErroMensagem',
      'integracao.incluirTipoAgendamentoMensagem',
      'integracao.alterarTipoAgendamentoMensagem',
      'integracao.incluirSituacaoEnvioMensagem',
      'integracao.alterarSituacaoEnvioMensagem',
      'integracao.incluirOperacaoWebservice',
      'integracao.alterarOperacaoWebservice',
      'integracao.incluirPadraoWebservice',
      'integracao.alterarPadraoWebservice',
    ]);
    // M26: incluir e alterar as modalidades de imagem, as grandezas do eco, os perfis, as permissões e os setores do
    // portal; incluir a modalidade e o usuário do perfil (vínculos); alterar o autocadastro do portal anterior.
    expect(OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M26').map((o) => o.receita.nome)).toEqual([
      'sadt.incluirModalidade',
      'sadt.alterarModalidade',
      'sadt.incluirGrandezaEco',
      'sadt.alterarGrandezaEco',
      'sadt.incluirPortalPerfil',
      'sadt.alterarPortalPerfil',
      'sadt.incluirPortalPerfilModalidade',
      'sadt.incluirPortalPerfilUsuario',
      'sadt.incluirPortalPermissao',
      'sadt.alterarPortalPermissao',
      'sadt.incluirPortalSetor',
      'sadt.alterarPortalSetor',
      'sadt.alterarAutocadastroLegado',
    ]);
    // M21: as 15 do CRUD genérico do marco (fichas da internação, higienização e SAME).
    expect(OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M21')).toHaveLength(15);
    // M24 (P-CAD-1): + as 43 dos demais cadastros de prescrição (91 + 43).
    // M20: alterar o modelo e o título; incluir e alterar as 4 seleções; alterar o local; incluir e inativar o
    // leito. W1-05: incluir o modelo, o título e o local.
    expect(OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M20').map((o) => o.receita.nome)).toEqual([
      'atendimento.incluirModeloFicha',
      'atendimento.alterarModeloFicha',
      'atendimento.incluirTituloFicha',
      'atendimento.alterarTituloFicha',
      'atendimento.incluirFichaConvenio',
      'atendimento.alterarFichaConvenio',
      'atendimento.incluirFichaEspecialidade',
      'atendimento.alterarFichaEspecialidade',
      'atendimento.incluirFichaUnidade',
      'atendimento.alterarFichaUnidade',
      'atendimento.incluirFichaGrupo',
      'atendimento.alterarFichaGrupo',
      'atendimento.incluirLocalObservacao',
      'atendimento.alterarLocalObservacao',
      'atendimento.incluirLeitoObservacao',
      'atendimento.inativarLeitoObservacao',
    ]);
    // M20: os efeitos medidos dos gatilhos do mapa de leitos entram no cenário da receita genérica, com as regras da
    // tabela do efeito.
    const incluirLeito = OPERACOES_DOMINIOS.find(
      (o) => o.receita.nome === 'atendimento.incluirLeitoObservacao',
    );
    expect(incluirLeito?.receita.cenarios[0]?.efeitos).toEqual({ 'TBLEITO:INSERT': 1, 'HTLEITO:INSERT': 1 });
    expect(Object.keys(incluirLeito?.receita.referencia?.classes ?? {}).sort()).toEqual([
      'HTLEITO',
      'RELEITO',
      'TBLEITO',
    ]);
    const inativarLeito = OPERACOES_DOMINIOS.find(
      (o) => o.receita.nome === 'atendimento.inativarLeitoObservacao',
    );
    expect(inativarLeito?.receita.cenarios[0]?.efeitos).toEqual({ 'TBLEITO:UPDATE': 1 });
    // M18: a agenda de exames (incluir, alterar, inativar), a escala (incluir, alterar) e a sala (incluir, alterar).
    expect(OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M18')).toHaveLength(7);
    // M14: o lote gerado (incluir, alterar e inativar onde a tabela tem coluna de situação provada; a inativação
    // só no novo não é operação do legado).
    expect(OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M14').length).toBeGreaterThan(150);
    expect(declaracao('cadastro.estadoCivil')?.tabela).toBe('TBECIV');
    expect(declaracao('x.y')).toBeUndefined();
    // Só o nome do prestador (pessoa ou empresa) é dado pessoal: a exportação pede justificativa.
    // M14 (regra 15): o cadastro dos técnicos do SADT também. M26: o autocadastro do médico do portal anterior (o nome).
    // M21: os profissionais da higienização (nome, CPF) e os telefones deles.
    expect(DECLARACOES.filter((d) => temDadoPessoal(d)).map((d) => d.tabela)).toEqual([
      'TBPRESER',
      'SITECNIC',
      'TBMEDSOLWEBCAD',
      'CHPROFISLIMP',
      'CHPROFLIMPTEL',
      // M32: o cliente (CPF ou CNPJ).
      'TBCLIENT',
      // M51 (etapa 2): o médico solicitante SUS (CPF, nome e CNS).
      'FAMEDSOL',
    ]);
  });
  it('nome de objeto inválido e chave ausente são recusados na declaração', () => {
    const d = declaracao('cadastro.religiao')!;
    expect(() => declararCadastroLegado({ ...d, tabela: 'tb-ruim' })).toThrow(/inválido/);
    expect(() => declararCadastroLegado({ ...d, chave: 'OUTRA' })).toThrow(/chave ausente/);
  });
  it('domínio de sistema não gera operação', () => {
    expect(operacoesDoDominio(declaracao('internacao.tipoAcomodacao')!, async () => [])).toEqual([]);
  });
});

describe('codec das colunas e Zod gerado', () => {
  const limpeza = declaracao('internacao.tipoLimpeza')!;
  const tempo = colunaDoCampo(limpeza, 'tempoPrevisto')!;
  it('M10: data civil ida e volta, inclusive o ano 9999 do feriado recorrente; inválida recusada', () => {
    const f = declaracao('organizacao.feriado')!;
    const c = colunaDoCampo(f, 'data')!;
    const d = valorParaColuna(c, '9999-12-25') as Date;
    expect(valorDaColuna(c, d)).toBe('9999-12-25');
    expect(valorDaColuna(c, valorParaColuna(c, '2026-01-01') as Date)).toBe('2026-01-01');
    expect(() => valorParaColuna(c, '25/12/2026')).toThrow(/AAAA-MM-DD/);
    expect(valorDaColuna(c, '2026-01-01')).toBe('2026-01-01');
    const z = esquemaInclusao(f);
    expect(z.safeParse({ data: '2026-02-30', nome: 'X', facultativo: 'F' }).success).toBe(false);
    expect(z.safeParse({ data: '9999-11-15', nome: 'Proclamação', facultativo: 'F' }).success).toBe(true);
    expect(z.safeParse({ data: '15-11-9999', nome: 'X', facultativo: 'F' }).success).toBe(false);
  });
  it('M51: CNS e CRM do solicitante SUS em branco gravam 0 (o legado não guarda NULL), e o 0 aparece vazio', () => {
    const d = declaracao('faturamento.susSolicitante')!;
    const [incluir, alterar] = operacoesDoDominio(d, async () => []);
    for (const campo of ['cns', 'crm']) {
      const c = colunaDoCampo(d, campo)!;
      expect(valorParaColuna(c, null)).toBe(0);
      expect(valorParaColuna(c, undefined)).toBe(0);
      expect(valorDaColuna(c, 0)).toBeNull();
      const coluna = c.coluna as 'CNS' | 'CRM';
      // A receita declara o 0 na inclusão e na alteração, e a alteração ganha o cenário de limpar.
      expect(incluir!.receita.passos[0]!.colunas[coluna]!.valor).toEqual({
        de: 'entrada',
        campo,
        seAusente: 0,
      });
      expect(alterar!.receita.passos[0]!.colunas[coluna]!.valor).toEqual({
        de: 'entrada',
        campo,
        seAusente: 0,
      });
      expect(alterar!.receita.cenarios.map((s) => s.nome)).toContain(`limpa-${campo}`);
    }
    // Em branco, o CNS passa (não é conferido pelo dígito); informado, é.
    const z = esquemaInclusao(d);
    expect(z.safeParse({ codigo: 52998224725, nome: 'Fulano Sintético', cns: null, crm: null }).success).toBe(
      true,
    );
    expect(z.safeParse({ codigo: 52998224725, nome: 'Fulano Sintético', cns: 123456789012345 }).success).toBe(
      false,
    );
  });
  it('M10: chave de texto digitada (bloco), nunca alterada', () => {
    const b = declaracao('organizacao.bloco')!;
    expect(colunaDoCampo(b, 'codigo')).toMatchObject({ tipo: 'texto', codigo: 'manual', editavel: false });
    expect(chaveDoCodigo(b, 'UTI')).toBe('UTI');
    expect(
      esquemaInclusao(b).safeParse({
        codigo: 'UTI',
        nome: 'Bloco UTI',
        unidade: 1,
        idadeMinima: 0,
        idadeMaxima: 120,
        ordem: 1,
      }).success,
    ).toBe(true);
  });
  it('hora: TIMESTAMP 1899-12-30 HH:MM ida e volta; formato inválido recusado', () => {
    const d = valorParaColuna(tempo, '01:30') as Date;
    expect(valorDaColuna(tempo, d)).toBe('01:30');
    expect(() => valorParaColuna(tempo, '25:00')).toThrow(/HH:MM/);
    expect(valorDaColuna(tempo, 'x')).toBe('x');
    expect(valorParaColuna(tempo, null)).toBeNull();
  });
  it('texto sem o preenchimento do CHAR; número; nulo', () => {
    const nome = colunaDoCampo(limpeza, 'nome')!;
    expect(valorDaColuna(nome, 'LIMPEZA  ')).toBe('LIMPEZA');
    expect(valorDaColuna(colunaDoCampo(limpeza, 'codigo')!, 7n)).toBe(7);
    expect(valorDaColuna(colunaDoCampo(limpeza, 'codigo')!, 'abc')).toBe('abc');
    expect(valorDaColuna(nome, null)).toBeNull();
  });
  it('Zod: tamanho em bytes CP1252, emoji recusado, letra só vista, referência inteira, campo a mais recusado', () => {
    const civil = esquemaInclusao(declaracao('cadastro.estadoCivil')!);
    expect(civil.safeParse({ codigoEstado: 3, sexo: 'F', nome: 'Casada' }).success).toBe(true);
    expect(civil.safeParse({ codigoEstado: 3, sexo: 'X', nome: 'Casada' }).success).toBe(false);
    expect(civil.safeParse({ codigoEstado: 3, sexo: 'F', nome: 'Nome comprido demais' }).success).toBe(false);
    expect(civil.safeParse({ codigoEstado: 3, sexo: 'F', nome: 'Casada 😀' }).success).toBe(false);
    expect(civil.safeParse({ codigoEstado: 3, sexo: 'F', nome: '' }).success).toBe(false);
    expect(civil.safeParse({ codigoEstado: 3, sexo: 'F', nome: 'X', id: 1 }).success).toBe(false);
    const via = esquemaInclusao(declaracao('pep.viaAdministracaoDieta')!);
    expect(via.safeParse({ codigo: 9, nome: 'Via sintética' }).success).toBe(true);
    expect(via.safeParse({ codigo: 10, nome: 'Via sintética' }).success).toBe(false);
    const alt = esquemaAlteracao(limpeza);
    expect(alt.safeParse({ codigo: '1', versao: '{}', valores: { tempoPrevisto: '01:00' } }).success).toBe(
      true,
    );
    expect(alt.safeParse({ codigo: '1', versao: '{}', valores: { nome: 'muda a chave' } }).success).toBe(
      false,
    );
  });
  it('chave do código e item da linha (situação NULL conta como ativo)', () => {
    expect(chaveDoCodigo(limpeza, '12')).toBe(12);
    expect(() => chaveDoCodigo(limpeza, 'x')).toThrow(/inválido/);
    expect(itemDaLinha(limpeza, { ID: 1, NOME: 'A', TEMPO_PREVISTO: null, ATIVO: null }).ativo).toBe(true);
    expect(itemDaLinha(limpeza, { ID: 1, NOME: 'A', TEMPO_PREVISTO: null, ATIVO: 'F' }).ativo).toBe(false);
    const campos = camposDescritos(declaracao('pep.tipoAlergia')!, (c) => c === 'NOME');
    expect(campos.find((c) => c.campo === 'classificacao')).toMatchObject({
      tipo: 'referencia',
      referencia: 'classificacao',
    });
    expect(campos.find((c) => c.campo === 'nome')?.aConfirmar).toBe(true);
  });
});

describe('receita genérica', () => {
  const religiao = declaracao('cadastro.religiao')!;
  const novoBanco = () => ({
    TBRELIG: {
      chave: 'COD',
      linhas: [
        { COD: 1, NOME: 'Católica' },
        { COD: 2, NOME: 'Evangélica' },
      ] as Linha[],
    },
  });

  it('incluir com código manual: confere duplicidade e código, grava, prova', async () => {
    const t = novoBanco();
    const e = escritorDuble(banco(t));
    const tx = txDaOperacao(e, new Set(['TBRELIG']));
    const o = op('cadastro.incluirReligiao');
    const entrada = { codigo: 30, nome: 'Religião sintética' };
    await o.conferir?.(tx, entrada, ctx, null);
    const r = await o.gravar(tx, entrada, ctx);
    expect(r).toEqual({ codigo: '30' });
    await o.provar(tx, entrada, r, ctx);
    expect(e.comandos.find((c) => c.sql.startsWith('INSERT'))?.sql).toBe(
      'INSERT INTO TBRELIG (COD, NOME) VALUES (?, ?)',
    );
    expect(o.eventos(entrada, r, ctx)).toEqual([
      { tipo: 'cadastro.religiao.incluido', carga: { codigo: '30' } },
    ]);
    expect(o.alvo(entrada, r)).toEqual({ tabela: 'TBRELIG', id: '30' });
  });

  it('incluir: descrição repetida (sem acento e caixa) e código existente são recusados (409)', async () => {
    const tx = txDaOperacao(escritorDuble(banco(novoBanco())), new Set(['TBRELIG']));
    const o = op('cadastro.incluirReligiao');
    await expect(o.conferir?.(tx, { codigo: 30, nome: 'catolica' }, ctx, null)).rejects.toMatchObject({
      problema: { codigo: 'duplicado', status: 409 },
    });
    await expect(o.conferir?.(tx, { codigo: 1, nome: 'Outra' }, ctx, null)).rejects.toMatchObject({
      problema: { codigo: 'duplicado' },
    });
  });

  it('incluir: chave violada vira 409; outro erro sobe; prova sem a linha falha', async () => {
    const o = op('cadastro.incluirReligiao');
    const viola = escritorDuble((c) => {
      if (c.sql.startsWith('INSERT'))
        throw new Error('violation of PRIMARY or UNIQUE KEY constraint "PK_TBRELIG"');
      return [];
    });
    await expect(
      o.gravar(txDaOperacao(viola, new Set(['TBRELIG'])), { codigo: 3, nome: 'x' }, ctx),
    ).rejects.toBeInstanceOf(ErroOperacao);
    const outro = escritorDuble((c) => {
      if (c.sql.startsWith('INSERT')) throw new Error('falha qualquer');
      return [];
    });
    await expect(
      o.gravar(txDaOperacao(outro, new Set(['TBRELIG'])), { codigo: 3, nome: 'x' }, ctx),
    ).rejects.toThrow('falha qualquer');
    await expect(
      o.provar(
        txDaOperacao(escritorDuble(), new Set(['TBRELIG'])),
        { codigo: 3, nome: 'x' },
        { codigo: '3' },
        ctx,
      ),
    ).rejects.toBeInstanceOf(ErroProva);
  });

  it('incluir com chave gerada pelo trigger, hora e situação ativa', async () => {
    const t = { CHTPLIMPEZA: { chave: 'ID', linhas: [] as Linha[], gerador: 6 } };
    const e = escritorDuble(banco(t));
    const tx = txDaOperacao(e, new Set(['CHTPLIMPEZA']));
    const o = op('internacao.incluirTipoLimpeza');
    const entrada = { nome: 'Limpeza sintética', tempoPrevisto: '01:30' };
    const r = await o.gravar(tx, entrada, ctx);
    expect(r.codigo).toBe('7');
    await o.provar(tx, entrada, r, ctx);
    const ins = e.comandos.find((c) => c.sql.startsWith('INSERT'));
    expect(ins?.sql).toBe(
      'INSERT INTO CHTPLIMPEZA (NOME, TEMPO_PREVISTO, ATIVO) VALUES (?, ?, ?) RETURNING ID',
    );
    expect(ins?.parametros[2]).toBe('T');
  });

  it('alterar: versão igual grava só as editáveis; versão velha dá 409 com o campo; inativo recusa', async () => {
    const t = novoBanco();
    const e = escritorDuble(banco(t));
    const tx = txDaOperacao(e, new Set(['TBRELIG']));
    const o = op('cadastro.alterarReligiao');
    const versao = versaoDaLinha(religiao, t.TBRELIG.linhas[0]!);
    const entrada = { codigo: '1', versao, valores: { nome: 'Católica romana' } };
    expect(o.travar?.(entrada, ctx)).toMatchObject({ tabela: 'TBRELIG', chave: { COD: 1 } });
    await o.conferir?.(tx, entrada, ctx, t.TBRELIG.linhas[0]!);
    await o.gravar(tx, entrada, ctx);
    await o.provar(tx, entrada, { codigo: '1' }, ctx);
    expect(t.TBRELIG.linhas[0]?.['NOME']).toBe('Católica romana');
    await expect(o.conferir?.(tx, entrada, ctx, t.TBRELIG.linhas[0]!)).rejects.toMatchObject({
      problema: { codigo: 'conflito-versao', colunas: ['nome'] },
    });
    await expect(
      o.conferir?.(tx, { ...entrada, versao: 'ruim' }, ctx, t.TBRELIG.linhas[0]!),
    ).rejects.toMatchObject({
      problema: { codigo: 'versao-invalida' },
    });
    await expect(o.gravar(tx, { codigo: '1', versao, valores: {} }, ctx)).rejects.toMatchObject({
      problema: { codigo: 'sem-alteracao' },
    });
    await expect(
      o.conferir?.(
        tx,
        {
          ...entrada,
          versao: versaoDaLinha(religiao, t.TBRELIG.linhas[1]!),
          codigo: '2',
          valores: { nome: 'Católica romana' },
        },
        ctx,
        t.TBRELIG.linhas[1]!,
      ),
    ).rejects.toMatchObject({
      problema: { codigo: 'duplicado' },
    });
    const limpeza = declaracao('internacao.tipoLimpeza')!;
    const inativa = { ID: 3, NOME: 'X', TEMPO_PREVISTO: null, ATIVO: 'F' };
    const ol = op('internacao.alterarTipoLimpeza');
    await expect(
      ol.conferir?.(tx, { codigo: '3', versao: versaoDaLinha(limpeza, inativa), valores: {} }, ctx, inativa),
    ).rejects.toMatchObject({
      problema: { codigo: 'inativo' },
    });
    await ol.conferir?.(tx, { codigo: '3', versao: 'x', valores: {} }, ctx, null);
  });

  it('inativar: sem uso grava a letra de inativo; em uso pede confirmação; já inativo recusa', async () => {
    const limpeza = declaracao('internacao.tipoLimpeza')!;
    const t = {
      CHTPLIMPEZA: {
        chave: 'ID',
        linhas: [
          { ID: 1, NOME: 'A', TEMPO_PREVISTO: null, ATIVO: 'T' },
          { ID: 2, NOME: 'B', TEMPO_PREVISTO: null, ATIVO: 'T' },
        ] as Linha[],
      },
    };
    const e = escritorDuble(banco(t));
    const tx = txDaOperacao(e, new Set(['CHTPLIMPEZA']));
    const usos = (codigo: string) =>
      Promise.resolve(
        codigo === '2' ? [{ regra: 'RESTRICT', usos: true }] : [{ regra: 'RESTRICT', usos: false }],
      );
    const [, , inativar] = operacoesDoDominio(limpeza, (_tx, _d, codigo) => usos(codigo));
    const v1 = versaoDaLinha(limpeza, t.CHTPLIMPEZA.linhas[0]!);
    await inativar!.conferir?.(tx, { codigo: '1', versao: v1 }, ctx, t.CHTPLIMPEZA.linhas[0]!);
    await inativar!.gravar(tx, { codigo: '1', versao: v1 }, ctx);
    await inativar!.provar(tx, { codigo: '1', versao: v1 }, { codigo: '1' }, ctx);
    expect(t.CHTPLIMPEZA.linhas[0]?.['ATIVO']).toBe('F');
    const v2 = versaoDaLinha(limpeza, t.CHTPLIMPEZA.linhas[1]!);
    await expect(
      inativar!.conferir?.(tx, { codigo: '2', versao: v2 }, ctx, t.CHTPLIMPEZA.linhas[1]!),
    ).rejects.toMatchObject({
      problema: { codigo: 'em-uso' },
    });
    await inativar!.conferir?.(
      tx,
      { codigo: '2', versao: v2, confirmarEmUso: true },
      ctx,
      t.CHTPLIMPEZA.linhas[1]!,
    );
    await expect(
      inativar!.conferir?.(
        tx,
        { codigo: '1', versao: versaoDaLinha(limpeza, t.CHTPLIMPEZA.linhas[0]!) },
        ctx,
        t.CHTPLIMPEZA.linhas[0]!,
      ),
    ).rejects.toMatchObject({
      problema: { codigo: 'ja-inativo' },
    });
    await expect(inativar!.gravar(tx, { codigo: '9', versao: v1 }, ctx)).rejects.toBeInstanceOf(ErroProva);
    // M14: sem coluna de situação, a inativação não é operação do legado (vale só no novo, SGH_).
    expect(
      operacoesDoDominio({ ...limpeza, situacao: undefined } as never, async () => []).map(
        (o) => o.receita.nome,
      ),
    ).toEqual(['internacao.incluirTipoLimpeza', 'internacao.alterarTipoLimpeza']);
  });
});

describe('leituras do CRUD genérico', () => {
  const via = declaracao('pep.viaAdministracaoDieta')!;
  const t = {
    PRVIAADMIN: {
      chave: 'ID',
      linhas: [
        { ID: 1, NOME: 'Oral', ID_TBTPDIETA: null },
        { ID: 2, NOME: 'Sonda', ID_TBTPDIETA: 13 },
      ] as Linha[],
    },
    TBTPDIETA: { chave: 'ID', linhas: [{ ID: 13, NOME: 'Enteral  ' }] as Linha[] },
    TBCLASSIFALERGIA: { chave: 'ID', linhas: [{ ID: 1, NOME: 'Medicamentosa' }] as Linha[] },
  };
  it('lista com versão, item pela chave, uso pelas FKs (só FK de uma coluna) e opções', async () => {
    const l = escritorDuble(banco(t, { '2': true }));
    const lista = await listarDominio(l, via);
    expect(lista.truncada).toBe(false);
    expect(lista.itens.map((i) => i.codigo)).toEqual(['1', '2']);
    expect(await itemDoDominio(l, via, '2')).toMatchObject({ codigo: '2', valores: { tipoDieta: 13 } });
    expect(await itemDoDominio(l, via, '7')).toBeNull();
    expect(await referenciasDaTabela(l, 'PRVIAADMIN')).toEqual([
      { tabela: 'TBFILHA', coluna: 'ID_DOMINIO', regra: 'RESTRICT' },
    ]);
    expect(await usoDoItem(l, via, '2')).toEqual([{ regra: 'RESTRICT', usos: true, tabela: 'TBFILHA' }]);
    expect(await opcoesDoCampo(l, via, 'tipoDieta', declaracao)).toEqual([
      { valor: 13, rotulo: 'Enteral', ativo: true },
    ]);
    expect(await opcoesDoCampo(l, declaracao('pep.tipoAlergia')!, 'classificacao', declaracao)).toEqual([
      { valor: 1, rotulo: 'Medicamentosa', ativo: true },
    ]);
    await expect(opcoesDoCampo(l, via, 'nome', declaracao)).rejects.toThrow(/sem referência/);
    await expect(
      opcoesDoCampo(l, declaracao('pep.tipoAlergia')!, 'classificacao', () => undefined),
    ).rejects.toThrow(/não declarado/);
  });
  it('teto: 501 linhas lidas marcam a lista como truncada', async () => {
    const muitas = {
      PRVIAADMIN: {
        chave: 'ID',
        linhas: Array.from({ length: 501 }, (_, i) => ({ ID: i + 1, NOME: `N${i}`, ID_TBTPDIETA: null })),
      },
    };
    const r = await listarDominio(escritorDuble(banco(muitas)), via);
    expect(r).toMatchObject({ truncada: true });
    expect(r.itens).toHaveLength(500);
  });
  it('filtro de escopo (M06, pendência 16): WHERE na coluna mapeada; restrito sem coluna falha fechado', async () => {
    const comEscopo = { ...via, escopos: { unidade: 'UNIDADE' } };
    expect(clausulaEscopo(comEscopo, { unidade: ['2', '3'] })).toEqual({
      sql: 'UNIDADE IN (?, ?)',
      parametros: ['2', '3'],
    });
    expect(clausulaEscopo(comEscopo, { unidade: [] })).toEqual({ sql: '1 = 0', parametros: [] });
    expect(clausulaEscopo(comEscopo, { unidade: null })).toEqual({ sql: '', parametros: [] });
    expect(clausulaEscopo(via, undefined)).toEqual({ sql: '', parametros: [] });
    expect(() => clausulaEscopo(via, { convenio: ['1'] })).toThrow(ErroEscopo);
    const e = escritorDuble(banco(t));
    await listarDominio(e, comEscopo, { unidade: ['2'] });
    await itemDoDominio(e, comEscopo, '1', { unidade: ['2'] });
    expect(e.comandos.map((c) => c.sql)).toEqual([
      expect.stringContaining('WHERE UNIDADE IN (?) ORDER BY ID'),
      expect.stringContaining('WHERE ID = ? AND UNIDADE IN (?)'),
    ]);
  });
});
