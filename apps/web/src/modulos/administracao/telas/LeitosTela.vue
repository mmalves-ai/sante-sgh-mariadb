<script setup lang="ts">
// "Blocos, acomodações e leitos" (M10, ficha seções 5 e 7; cap-06a §6.1): um cadastro só, em árvore bloco →
// acomodação → leito, com as contagens de ativos e ocupados; incluir e alterar acomodação, incluir leito, alterar o
// ramal, inativar e reativar (as receitas do executor, sempre com a senha de novo; o registro de conferência é dos
// gatilhos do banco). A inclusão pede o que o banco sempre tem preenchido (andar, centro de custo, local de conta,
// tipo TISS); idades e diária vazias ficam com o valor do banco, nunca vazio. Na aba
// Conferência, onde o cadastro e o registro de conferência discordam, com a orientação de cada divergência.
// A ocupação vem da internação (M15) e não se edita aqui; leito ocupado não se inativa (o servidor recusa).
import {
  CONVENIOS_ACOMODACAO,
  type AcomodacaoTela,
  type LeitoTela,
  SEXOS_ACOMODACAO,
  tipoDoProblema,
} from '@sgh/contratos';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarConferencia, buscarLeitos, gravarLeito } from '../api.js';
import DominiosIndiceTela from '../../config/telas/DominiosIndiceTela.vue';
import EstadoGravacoes from '../componentes/EstadoGravacoes.vue';
import SenhaConfirmacao from '../componentes/SenhaConfirmacao.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const aba = ref<'cadastro' | 'conferencia'>('cadastro');
const leitos = useQuery({ queryKey: ['adm', 'leitos'], queryFn: () => buscarLeitos() });
const conferencia = useQuery({
  queryKey: ['adm', 'leitos-conferencia'],
  queryFn: () => buscarConferencia(),
  enabled: computed(() => aba.value === 'conferencia'),
});
const podeEditar = computed(() => pode('organizacao.leito.editar'));
const ligada = (op: string) =>
  leitos.data.value?.operacoes.find((o) => o.operacao === `organizacao.${op}`)?.ligada ?? false;
const aviso = ref('');
const recusa = ref('');
const erro = ref<unknown>(null);
/** A senha digitada na hora (nunca guardada): limpa depois de cada gravação. */
const senha = ref('');

async function executar(op: string, entrada: unknown): Promise<boolean> {
  aviso.value = '';
  recusa.value = '';
  erro.value = null;
  try {
    await gravarLeito(op, entrada, senha.value);
    aviso.value = t('adm.comum.gravado');
    await cliente.invalidateQueries({ queryKey: ['adm', 'leitos'] });
    await cliente.invalidateQueries({ queryKey: ['adm', 'leitos-conferencia'] });
    return true;
  } catch (e) {
    if (e instanceof ErroApi && e.problema && tipoDoProblema(e.problema) === 'recusa-de-negocio')
      recusa.value = e.problema.detail ?? e.problema.title ?? '';
    else erro.value = e;
    return false;
  } finally {
    senha.value = '';
  }
}

// ── Leito: ramal, inativar, reativar ──
const ramais = ref<Record<number, string>>({});
async function salvarRamal(l: LeitoTela): Promise<void> {
  const v = (ramais.value[l.id] ?? '').trim();
  await executar('alterarLeito', { id: l.id, versao: l.versao, ramal: v === '' ? null : Number(v) });
}
async function situacao(l: LeitoTela, inativar: boolean): Promise<void> {
  // A confirmação da inativação é a do SanteBotao destrutivo.
  await executar(inativar ? 'inativarLeito' : 'reativarLeito', { id: l.id, versao: l.versao });
}

// ── Alterar acomodação (nome, andar e quantidade de leitos, com a versão lida) ──
const dialogoAlterar = ref(false);
const alterando = ref<{ bloco: string; a: AcomodacaoTela } | null>(null);
const edicao = ref({ nome: '', andar: '', leitos: '' });
function abrirAlterar(bloco: string, a: AcomodacaoTela): void {
  alterando.value = { bloco, a };
  edicao.value = { nome: a.nome, andar: String(a.andar ?? ''), leitos: String(a.leitosPrevistos ?? '') };
  dialogoAlterar.value = true;
}
async function alterarAcomodacao(): Promise<void> {
  if (!alterando.value) return;
  const { bloco, a } = alterando.value;
  const x = edicao.value;
  const ok = await executar('alterarAcomodacao', {
    bloco,
    acomodacao: a.acomodacao,
    versao: a.versao,
    ...(x.nome.trim() !== a.nome ? { nome: x.nome.trim() } : {}),
    ...(num(x.andar) !== undefined && num(x.andar) !== a.andar ? { andar: num(x.andar) } : {}),
    ...(num(x.leitos) !== undefined && num(x.leitos) !== a.leitosPrevistos ? { leitos: num(x.leitos) } : {}),
  });
  if (ok) dialogoAlterar.value = false;
}

// ── Nova acomodação ──
const dialogoAcomodacao = ref(false);
const blocoNovo = ref('');
const acomVazia = () => ({
  acomodacao: '',
  nome: '',
  andar: '',
  leitos: '1',
  sexo: 'A',
  tipo: '',
  convenio: 'A',
  centroCusto: '',
  localConta: '',
  tiss: '',
  idadeMinima: '',
  idadeMaxima: '',
});
const acom = ref(acomVazia());
/** Os combos obrigatórios (tipo, centro de custo, local de conta e tipo TISS) sem escolha: a gravação não sai. */
const faltaAcom = ref(false);
function abrirAcomodacao(bloco: string): void {
  blocoNovo.value = bloco;
  acom.value = acomVazia();
  faltaAcom.value = false;
  dialogoAcomodacao.value = true;
}
const comoTexto = (lista: readonly { valor: number | string; rotulo: string }[] | undefined) =>
  (lista ?? []).map((o) => ({ valor: String(o.valor), rotulo: o.rotulo }));
const semEscolha = { valor: '', rotulo: '—', desabilitada: true };
const opcoesSexo = computed(() =>
  SEXOS_ACOMODACAO.map((s) => ({ valor: s, rotulo: t(`adm.leitos.sexos.${s}`) })),
);
const opcoesConvenio = computed(() =>
  CONVENIOS_ACOMODACAO.map((c) => ({ valor: c, rotulo: t(`adm.leitos.convenios.${c}`) })),
);
const opcoesTipo = computed(() => comoTexto(leitos.data.value?.opcoes.tipos));
const opcoesCentroCusto = computed(() => [semEscolha, ...comoTexto(leitos.data.value?.opcoes.centrosCusto)]);
const opcoesLocalConta = computed(() => [semEscolha, ...comoTexto(leitos.data.value?.opcoes.locaisConta)]);
const opcoesTiss = computed(() => [semEscolha, ...comoTexto(leitos.data.value?.opcoes.tiposTiss)]);
/** Campo numérico (o v-model de input number pode entregar número ou texto). */
const num = (s: string | number) => (String(s).trim() === '' ? undefined : Number(s));
async function incluirAcomodacao(): Promise<void> {
  const a = acom.value;
  faltaAcom.value = !a.tipo || !a.centroCusto || !a.localConta || !a.tiss;
  if (faltaAcom.value) return;
  const ok = await executar('incluirAcomodacao', {
    bloco: blocoNovo.value,
    acomodacao: a.acomodacao.trim(),
    nome: a.nome.trim(),
    leitos: Number(a.leitos),
    sexo: a.sexo,
    tipo: Number(a.tipo || '0'),
    convenio: a.convenio,
    andar: Number(a.andar),
    centroCusto: Number(a.centroCusto),
    localConta: Number(a.localConta),
    acomodacaoTiss: Number(a.tiss),
    ...(num(a.idadeMinima) !== undefined ? { idadeMinima: num(a.idadeMinima) } : {}),
    ...(num(a.idadeMaxima) !== undefined ? { idadeMaxima: num(a.idadeMaxima) } : {}),
  });
  if (ok) dialogoAcomodacao.value = false;
}

// ── Novo leito ──
const dialogoLeito = ref(false);
const alvo = ref<{ bloco: string; acomodacao: AcomodacaoTela } | null>(null);
const hoje = new Date();
const leitoVazio = (andar: number | null = null) => ({
  leito: '',
  ramal: '',
  andar: andar === null ? '' : String(andar),
  diaria: '',
  mes: String(hoje.getMonth() + 1),
  ano: String(hoje.getFullYear()),
});
const novoLeito = ref(leitoVazio());
function abrirLeito(bloco: string, acomodacao: AcomodacaoTela): void {
  alvo.value = { bloco, acomodacao };
  novoLeito.value = leitoVazio(acomodacao.andar);
  dialogoLeito.value = true;
}
async function incluirLeito(): Promise<void> {
  if (!alvo.value) return;
  const n = novoLeito.value;
  const ok = await executar('incluirLeito', {
    bloco: alvo.value.bloco,
    acomodacao: alvo.value.acomodacao.acomodacao,
    leito: n.leito.trim(),
    mesVigente: Number(n.mes),
    anoVigente: Number(n.ano),
    andar: Number(n.andar),
    ...(num(n.ramal) !== undefined ? { ramal: num(n.ramal) } : {}),
    ...(num(n.diaria) !== undefined ? { diaria: num(n.diaria) } : {}),
  });
  if (ok) dialogoLeito.value = false;
}
</script>

<template>
  <section class="tela" aria-labelledby="leitos-titulo">
    <h1 id="leitos-titulo">{{ t('adm.leitos.titulo') }}</h1>
    <p>{{ t('adm.leitos.texto') }}</p>
    <div class="abas" role="group" :aria-label="t('adm.leitos.titulo')">
      <SanteBotao
        :rotulo="t('adm.leitos.abaCadastro')"
        :variante="aba === 'cadastro' ? 'primario' : 'secundario'"
        :aria-pressed="aba === 'cadastro'"
        data-testid="aba-cadastro"
        @acionar="aba = 'cadastro'"
      />
      <SanteBotao
        :rotulo="t('adm.leitos.abaConferencia')"
        :variante="aba === 'conferencia' ? 'primario' : 'secundario'"
        :aria-pressed="aba === 'conferencia'"
        data-testid="aba-conferencia"
        @acionar="aba = 'conferencia'"
      />
    </div>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="leitos-aviso" />
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="leitos-recusa" />
    <MensagemErro v-if="erro" :erro="erro" />

    <template v-if="aba === 'cadastro'">
      <MensagemErro v-if="leitos.isError.value" :erro="leitos.error.value" />
      <p v-else-if="leitos.isPending.value">{{ t('adm.comum.carregando') }}</p>
      <template v-else-if="leitos.data.value">
        <EstadoGravacoes :operacoes="leitos.data.value.operacoes" />
        <p role="status">
          {{ t('adm.leitos.totais', leitos.data.value.totais) }}
          <span v-if="leitos.data.value.destino === 'memoria'"> · {{ t('adm.comum.memoria') }}</span>
        </p>
        <div v-if="podeEditar" class="senha-acoes">
          <p>{{ t('adm.leitos.senhaAcoes') }}</p>
          <SenhaConfirmacao v-model="senha" testid="leitos-senha" />
        </div>
        <p v-if="leitos.data.value.orfaos.length">
          {{ t('adm.leitos.orfaos', { n: leitos.data.value.orfaos.length }) }}
        </p>
        <ul class="arvore" data-testid="arvore-leitos">
          <li v-for="b in leitos.data.value.blocos" :key="b.bloco" :data-testid="`bloco-${b.bloco}`">
            <strong>{{ b.bloco }} — {{ b.nome }}</strong>
            <span>
              ({{
                t('adm.leitos.leitosDaAcomodacao', {
                  ativos: b.ativos,
                  total: b.acomodacoes.reduce((s, a) => s + a.leitos.length, 0),
                  ocupados: b.ocupados,
                })
              }})</span
            >
            <SanteBotao
              v-if="podeEditar && ligada('incluirAcomodacao')"
              :rotulo="t('adm.leitos.novaAcomodacao')"
              variante="texto"
              :data-testid="`nova-acomodacao-${b.bloco}`"
              @acionar="abrirAcomodacao(b.bloco)"
            />
            <ul>
              <li
                v-for="a in b.acomodacoes"
                :key="a.acomodacao"
                :data-testid="`acomodacao-${b.bloco}-${a.acomodacao}`"
              >
                {{ t('adm.leitos.acomodacao', { codigo: a.acomodacao, nome: a.nome }) }} ·
                {{
                  t('adm.leitos.leitosDaAcomodacao', {
                    ativos: a.ativos,
                    total: a.leitos.length,
                    ocupados: a.ocupados,
                  })
                }}
                <SanteBotao
                  v-if="podeEditar && ligada('alterarAcomodacao')"
                  :rotulo="t('adm.leitos.alterarAcomodacao')"
                  variante="texto"
                  :data-testid="`alterar-acomodacao-${b.bloco}-${a.acomodacao}`"
                  @acionar="abrirAlterar(b.bloco, a)"
                />
                <SanteBotao
                  v-if="podeEditar && ligada('incluirLeito')"
                  :rotulo="t('adm.leitos.novoLeito')"
                  variante="texto"
                  :data-testid="`novo-leito-${b.bloco}-${a.acomodacao}`"
                  @acionar="abrirLeito(b.bloco, a)"
                />
                <table v-if="a.leitos.length">
                  <caption class="oculto">
                    {{
                      t('adm.leitos.acomodacao', { codigo: a.acomodacao, nome: a.nome })
                    }}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{{ t('adm.leitos.leito') }}</th>
                      <th scope="col">{{ t('adm.comum.situacao') }}</th>
                      <th scope="col">{{ t('adm.leitos.ramal') }}</th>
                      <th v-if="podeEditar" scope="col">
                        <span class="oculto">{{ t('adm.comum.alterar') }}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="l in a.leitos"
                      :key="l.id"
                      :data-testid="`leito-${b.bloco}-${a.acomodacao}-${l.leito}`"
                    >
                      <th scope="row">{{ l.leito }}</th>
                      <td>
                        {{ l.ativo ? t('adm.comum.ativo') : t('adm.comum.inativo') }} ·
                        {{ l.ocupado ? t('adm.leitos.ocupado') : t('adm.leitos.livre') }}
                      </td>
                      <td>
                        <template v-if="podeEditar && ligada('alterarLeito')">
                          <label class="oculto" :for="`ramal-${l.id}`">{{ t('adm.leitos.ramal') }}</label>
                          <input
                            :id="`ramal-${l.id}`"
                            :value="ramais[l.id] ?? l.ramal ?? ''"
                            inputmode="numeric"
                            size="6"
                            @input="ramais[l.id] = ($event.target as HTMLInputElement).value"
                          />
                          <SanteBotao
                            :rotulo="t('adm.comum.salvar')"
                            variante="texto"
                            @acionar="salvarRamal(l)"
                          />
                        </template>
                        <template v-else>{{ l.ramal ?? '—' }}</template>
                      </td>
                      <td v-if="podeEditar">
                        <SanteBotao
                          v-if="l.ativo && ligada('inativarLeito')"
                          :rotulo="t('adm.leitos.inativar')"
                          variante="destrutivo"
                          :confirmacao="t('adm.leitos.confirmarInativar', { leito: l.leito })"
                          :data-testid="`inativar-${l.id}`"
                          @acionar="situacao(l, true)"
                        />
                        <SanteBotao
                          v-if="!l.ativo && ligada('reativarLeito')"
                          :rotulo="t('adm.leitos.reativar')"
                          variante="texto"
                          :data-testid="`reativar-${l.id}`"
                          @acionar="situacao(l, false)"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </li>
            </ul>
          </li>
        </ul>
        <h2>{{ t('adm.leitos.blocos') }}</h2>
        <DominiosIndiceTela subitem="estruturaLeitos" :embutido="true" />
      </template>
    </template>

    <template v-else>
      <p>{{ t('adm.leitos.conferenciaTexto') }}</p>
      <MensagemErro v-if="conferencia.isError.value" :erro="conferencia.error.value" />
      <p v-else-if="conferencia.isPending.value">{{ t('adm.comum.carregando') }}</p>
      <template v-else-if="conferencia.data.value">
        <div role="status">
          <ul data-testid="conferencia-resumo">
            <li>{{ t('adm.leitos.divergencias', { n: conferencia.data.value.divergencias.length }) }}</li>
            <li>{{ t('adm.leitos.iguais', { n: conferencia.data.value.contagens.iguais }) }}</li>
            <li>
              {{ t('adm.leitos.externo', { n: conferencia.data.value.contagens.leitosEspelhoExterno }) }}
            </li>
            <li>{{ t('adm.leitos.retratos', { n: conferencia.data.value.retratos }) }}</li>
            <li>{{ t('adm.leitos.tempo', { ms: conferencia.data.value.tempoMs }) }}</li>
          </ul>
        </div>
        <table v-if="conferencia.data.value.divergencias.length" data-testid="tabela-divergencias">
          <caption>
            {{
              t('adm.leitos.divergencias', { n: conferencia.data.value.divergencias.length })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('adm.leitos.leito') }}</th>
              <th scope="col">{{ t('adm.comum.situacao') }}</th>
              <th scope="col">
                <span class="oculto">{{ t('adm.leitos.conferenciaTexto') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(d, i) in conferencia.data.value.divergencias" :key="i">
              <th scope="row">{{ d.chave }}</th>
              <td>{{ t(`adm.leitos.tipos.${d.tipo}`) }}</td>
              <td>{{ d.orientacao }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>

    <SanteDialogo v-model:visivel="dialogoAcomodacao" :titulo="t('adm.leitos.novaAcomodacao')">
      <form class="form" data-testid="form-acomodacao" @submit.prevent="incluirAcomodacao">
        <p>{{ t('adm.leitos.bloco') }}: {{ blocoNovo }}</p>
        <div class="campo">
          <label for="acom-codigo">{{ t('adm.leitos.codigoAcomodacao') }}</label>
          <input
            id="acom-codigo"
            v-model="acom.acomodacao"
            maxlength="6"
            required
            data-testid="acom-codigo"
          />
        </div>
        <div class="campo">
          <label for="acom-nome">{{ t('adm.leitos.nome') }}</label>
          <input id="acom-nome" v-model="acom.nome" maxlength="40" required data-testid="acom-nome" />
        </div>
        <div class="campo">
          <label for="acom-qtd">{{ t('adm.leitos.quantidade') }}</label>
          <input id="acom-qtd" v-model="acom.leitos" type="number" min="1" max="99" required />
        </div>
        <div class="campo">
          <label for="acom-andar">{{ t('adm.leitos.andar') }}</label>
          <input
            id="acom-andar"
            v-model="acom.andar"
            type="number"
            min="0"
            max="99"
            required
            data-testid="acom-andar"
          />
        </div>
        <SanteSelecao
          id="acom-sexo"
          v-model="acom.sexo"
          class="campo"
          :rotulo="t('adm.leitos.sexo')"
          :opcoes="opcoesSexo"
        />
        <SanteSelecao
          id="acom-tipo"
          v-model="acom.tipo"
          obrigatorio
          class="campo"
          :rotulo="t('adm.leitos.tipo')"
          :opcoes="opcoesTipo"
          data-testid="acom-tipo"
        />
        <SanteSelecao
          id="acom-convenio"
          v-model="acom.convenio"
          class="campo"
          :rotulo="t('adm.leitos.convenio')"
          :opcoes="opcoesConvenio"
        />
        <SanteSelecao
          id="acom-cc"
          v-model="acom.centroCusto"
          obrigatorio
          class="campo"
          :rotulo="t('adm.leitos.centroCusto')"
          :opcoes="opcoesCentroCusto"
          data-testid="acom-cc"
        />
        <SanteSelecao
          id="acom-lc"
          v-model="acom.localConta"
          obrigatorio
          class="campo"
          :rotulo="t('adm.leitos.localConta')"
          :opcoes="opcoesLocalConta"
          data-testid="acom-lc"
        />
        <SanteSelecao
          id="acom-tiss"
          v-model="acom.tiss"
          obrigatorio
          class="campo"
          :rotulo="t('adm.leitos.tiss')"
          :opcoes="opcoesTiss"
          data-testid="acom-tiss"
        />
        <div class="campo">
          <label for="acom-idmin">{{ t('adm.leitos.idadeMinima') }}</label>
          <input id="acom-idmin" v-model="acom.idadeMinima" type="number" min="0" max="999" />
        </div>
        <div class="campo">
          <label for="acom-idmax">{{ t('adm.leitos.idadeMaxima') }}</label>
          <input id="acom-idmax" v-model="acom.idadeMaxima" type="number" min="0" max="999" />
        </div>
        <SanteAlerta
          v-if="faltaAcom"
          :texto="t('adm.leitos.faltaEscolha')"
          variante="aviso"
          anunciar
          data-testid="acom-falta"
        />
        <SenhaConfirmacao v-model="senha" testid="acom-senha" />
        <div class="acoes">
          <SanteBotao :rotulo="t('adm.comum.salvar')" tipo="submit" data-testid="salvar-acomodacao" />
          <SanteBotao
            :rotulo="t('adm.comum.cancelar')"
            variante="texto"
            @acionar="dialogoAcomodacao = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo v-model:visivel="dialogoLeito" :titulo="t('adm.leitos.novoLeito')">
      <form class="form" data-testid="form-leito" @submit.prevent="incluirLeito">
        <p v-if="alvo">
          {{ t('adm.leitos.acomodacao', { codigo: alvo.acomodacao.acomodacao, nome: alvo.acomodacao.nome }) }}
        </p>
        <div class="campo">
          <label for="leito-codigo">{{ t('adm.leitos.codigoLeito') }}</label>
          <input
            id="leito-codigo"
            v-model="novoLeito.leito"
            maxlength="5"
            required
            data-testid="leito-codigo"
          />
        </div>
        <div class="campo">
          <label for="leito-ramal">{{ t('adm.leitos.ramal') }}</label>
          <input id="leito-ramal" v-model="novoLeito.ramal" inputmode="numeric" data-testid="leito-ramal" />
        </div>
        <div class="campo">
          <label for="leito-andar">{{ t('adm.leitos.andar') }}</label>
          <input
            id="leito-andar"
            v-model="novoLeito.andar"
            type="number"
            min="0"
            max="99"
            required
            data-testid="leito-andar"
          />
        </div>
        <div class="campo">
          <label for="leito-diaria">{{ t('adm.leitos.diaria') }}</label>
          <input id="leito-diaria" v-model="novoLeito.diaria" type="number" min="0" max="32767" />
        </div>
        <div class="campo">
          <label for="leito-mes">{{ t('adm.leitos.mesVigente') }}</label>
          <input id="leito-mes" v-model="novoLeito.mes" type="number" min="1" max="12" required />
        </div>
        <div class="campo">
          <label for="leito-ano">{{ t('adm.leitos.anoVigente') }}</label>
          <input id="leito-ano" v-model="novoLeito.ano" type="number" min="1900" max="9999" required />
        </div>
        <SenhaConfirmacao v-model="senha" testid="leito-senha" />
        <div class="acoes">
          <SanteBotao :rotulo="t('adm.comum.salvar')" tipo="submit" data-testid="salvar-leito" />
          <SanteBotao :rotulo="t('adm.comum.cancelar')" variante="texto" @acionar="dialogoLeito = false" />
        </div>
      </form>
    </SanteDialogo>
    <SanteDialogo
      v-model:visivel="dialogoAlterar"
      :titulo="t('adm.leitos.alterarAcomodacaoDe', { codigo: alterando?.a.acomodacao ?? '' })"
    >
      <form class="form" data-testid="form-alterar-acomodacao" @submit.prevent="alterarAcomodacao">
        <div class="campo">
          <label for="alt-nome">{{ t('adm.leitos.nome') }}</label>
          <input id="alt-nome" v-model="edicao.nome" maxlength="40" required data-testid="alt-nome" />
        </div>
        <div class="campo">
          <label for="alt-andar">{{ t('adm.leitos.andar') }}</label>
          <input id="alt-andar" v-model="edicao.andar" type="number" min="0" max="99" required />
        </div>
        <div class="campo">
          <label for="alt-qtd">{{ t('adm.leitos.quantidade') }}</label>
          <input
            id="alt-qtd"
            v-model="edicao.leitos"
            type="number"
            min="1"
            max="99"
            required
            data-testid="alt-qtd"
          />
        </div>
        <SenhaConfirmacao v-model="senha" testid="alt-senha" />
        <div class="acoes">
          <SanteBotao :rotulo="t('adm.comum.salvar')" tipo="submit" data-testid="salvar-alteracao" />
          <SanteBotao :rotulo="t('adm.comum.cancelar')" variante="texto" @acionar="dialogoAlterar = false" />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.senha-acoes {
  margin: var(--sgh-espaco-2) 0;
}
.abas,
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
  margin: var(--sgh-espaco-2) 0;
}
.arvore ul {
  padding-left: var(--sgh-espaco-4);
}
.form,
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
table {
  border-collapse: collapse;
  margin: var(--sgh-espaco-1) 0;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
caption {
  text-align: left;
  font-weight: 600;
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
