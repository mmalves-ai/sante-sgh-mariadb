<script setup lang="ts">
// Painel de onboarding de clientes da plataforma (F4 L3; plano F4 seção 2; ADR 0003 itens 4 a 9): lista dos clientes
// com a origem vinculada e a última execução; novo cliente; vincular o arquivo .fdb da pasta autorizada; Importar e
// Sincronizar com a barra de progresso (acompanhada enquanto a execução está ativa) e a conciliação por entidade.
// Só o administrador da plataforma (o servidor recusa os demais). Na tela, só agregados.
import type { ClienteOnboarding, ExecucaoConector, OrigemDisponivel } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  criarCliente,
  execucaoAtiva,
  lerExecucao,
  listarClientes,
  listarExecucoes,
  listarOrigens,
  pedirExecucao,
  tamanhoLegivel,
  vincularOrigem,
} from '../api-onboarding.js';
import RelatorioExecucao from './RelatorioExecucao.vue';

const { t, te } = useI18n();
const clientes = ref<ClienteOnboarding[] | null>(null);
const erro = ref<string | null>(null);
const aviso = ref<string | null>(null);
const ocupado = ref(false);
const codigo = ref('');
const nome = ref('');
const aberto = ref<string | null>(null);
const origens = ref<OrigemDisponivel[] | null>(null);
const execucao = ref<ExecucaoConector | null>(null);
const historico = ref<ExecucaoConector[]>([]);

async function carregarHistorico(cod: string): Promise<void> {
  try {
    historico.value = (await listarExecucoes(cod)).execucoes;
  } catch (e) {
    erro.value = mensagem(e);
  }
}
let relogio: ReturnType<typeof setInterval> | null = null;

const cliente = computed(() => clientes.value?.find((c) => c.codigo === aberto.value) ?? null);
const codigoValido = computed(() => /^[a-z][a-z0-9_]{1,39}$/.test(codigo.value));
const rotuloEntidade = (e: string) => (te(`onboarding.entidades.${e}`) ? t(`onboarding.entidades.${e}`) : e);
const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function carregar(): Promise<void> {
  try {
    clientes.value = (await listarClientes()).clientes;
    erro.value = null;
  } catch (e) {
    erro.value = mensagem(e);
  }
}

function parar(): void {
  if (relogio) clearInterval(relogio);
  relogio = null;
}

async function acompanhar(cod: string, id: number): Promise<void> {
  parar();
  const passo = async () => {
    try {
      execucao.value = await lerExecucao(cod, id);
      if (!execucaoAtiva(execucao.value)) {
        parar();
        await carregar();
        await carregarHistorico(cod);
      }
    } catch (e) {
      erro.value = mensagem(e);
      parar();
    }
  };
  await passo();
  if (execucaoAtiva(execucao.value)) relogio = setInterval(passo, 2000);
}

async function abrir(c: ClienteOnboarding): Promise<void> {
  aberto.value = c.codigo;
  execucao.value = c.ultimaExecucao;
  aviso.value = null;
  origens.value = null;
  historico.value = [];
  if (c.ultimaExecucao) await acompanhar(c.codigo, c.ultimaExecucao.id);
  await carregarHistorico(c.codigo);
  try {
    origens.value = (await listarOrigens()).origens;
  } catch (e) {
    erro.value = mensagem(e);
  }
}

async function criar(): Promise<void> {
  if (!codigoValido.value || !nome.value.trim()) return;
  ocupado.value = true;
  aviso.value = t('onboarding.novo.criando');
  try {
    const r = await criarCliente(codigo.value, nome.value.trim());
    aviso.value = t('onboarding.novo.criado', { codigo: r.codigo, banco: r.banco, tabelas: r.tabelas });
    codigo.value = '';
    nome.value = '';
    await carregar();
  } catch (e) {
    aviso.value = null;
    erro.value = mensagem(e);
  } finally {
    ocupado.value = false;
  }
}

async function vincular(arquivo: string): Promise<void> {
  if (!cliente.value) return;
  ocupado.value = true;
  aviso.value = t('onboarding.cliente.vinculando');
  try {
    await vincularOrigem(cliente.value.codigo, arquivo);
    aviso.value = null;
    await carregar();
  } catch (e) {
    aviso.value = null;
    erro.value = mensagem(e);
  } finally {
    ocupado.value = false;
  }
}

async function executar(tipo: 'importar' | 'sincronizar', confirmarExclusaoEmMassa = false): Promise<void> {
  const c = cliente.value;
  if (!c) return;
  ocupado.value = true;
  try {
    const { execucao: id } = await pedirExecucao(c.codigo, tipo, confirmarExclusaoEmMassa);
    erro.value = null;
    await acompanhar(c.codigo, id);
    await carregar();
  } catch (e) {
    erro.value = mensagem(e);
  } finally {
    ocupado.value = false;
  }
}

const podeSincronizar = computed(
  () => cliente.value?.ultimaExecucao?.estado === 'concluida' || execucao.value?.estado === 'concluida',
);

onMounted(carregar);
onBeforeUnmount(parar);
</script>

<template>
  <section class="tela-onboarding" aria-labelledby="onb-titulo" data-testid="tela-onboarding">
    <h1 id="onb-titulo">{{ t('onboarding.titulo') }}</h1>
    <p>{{ t('onboarding.texto') }}</p>
    <SanteAlerta v-if="erro" :texto="erro" variante="alerta" anunciar data-testid="onb-erro" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="onb-aviso" />

    <p v-if="clientes === null && !erro" role="status">{{ t('onboarding.carregando') }}</p>
    <table v-else-if="clientes" class="tabela" data-testid="onb-clientes">
      <caption>
        {{
          t('onboarding.legenda')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('onboarding.colunas.codigo') }}</th>
          <th scope="col">{{ t('onboarding.colunas.nome') }}</th>
          <th scope="col">{{ t('onboarding.colunas.situacao') }}</th>
          <th scope="col">{{ t('onboarding.colunas.origem') }}</th>
          <th scope="col">{{ t('onboarding.colunas.execucao') }}</th>
          <th scope="col">
            <span class="sr-only">{{ t('onboarding.abrir') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="clientes.length === 0">
          <td colspan="6">{{ t('onboarding.semClientes') }}</td>
        </tr>
        <tr v-for="c in clientes" :key="c.codigo" :data-testid="`onb-cliente-${c.codigo}`">
          <td>{{ c.codigo }}</td>
          <td>{{ c.nome }}</td>
          <td>{{ c.situacao }}</td>
          <td>{{ c.origem ? c.origem.arquivo : t('onboarding.semOrigem') }}</td>
          <td>
            <template v-if="c.ultimaExecucao">
              {{ t(`onboarding.estados.${c.ultimaExecucao.estado}`) }} ({{ c.ultimaExecucao.percentual }}%)
            </template>
          </td>
          <td>
            <SanteBotao variante="secundario" :rotulo="t('onboarding.abrir')" @acionar="abrir(c)" />
          </td>
        </tr>
      </tbody>
    </table>
    <SanteBotao variante="texto" :rotulo="t('onboarding.atualizar')" @acionar="carregar" />

    <section v-if="cliente" class="bloco" aria-labelledby="onb-cliente" data-testid="onb-detalhe">
      <h2 id="onb-cliente">{{ t('onboarding.cliente.titulo', { codigo: cliente.codigo }) }}</h2>
      <h3>{{ t('onboarding.cliente.origem') }}</h3>
      <p v-if="cliente.origem" data-testid="onb-vinculado">
        {{
          t('onboarding.cliente.vinculado', {
            arquivo: cliente.origem.arquivo,
            tamanho: tamanhoLegivel(cliente.origem.tamanhoBytes),
            resumo: cliente.origem.sha256.slice(0, 12),
          })
        }}
      </p>
      <h4>{{ t('onboarding.cliente.escolher') }}</h4>
      <p v-if="origens === null" role="status">{{ t('onboarding.carregando') }}</p>
      <p v-else-if="origens.length === 0">{{ t('onboarding.cliente.semArquivos') }}</p>
      <ul v-else class="origens" data-testid="onb-origens">
        <li v-for="o in origens" :key="o.arquivo">
          <span>{{ o.arquivo }} ({{ tamanhoLegivel(o.tamanhoBytes) }})</span>
          <SanteBotao
            v-if="o.aceito"
            variante="secundario"
            :rotulo="t('onboarding.cliente.vincular')"
            :desabilitado="ocupado || execucaoAtiva(execucao)"
            @acionar="vincular(o.arquivo)"
          />
          <span v-else class="secundario">{{
            t('onboarding.cliente.recusado', { motivo: o.motivo ?? '' })
          }}</span>
        </li>
      </ul>

      <div class="acoes">
        <SanteBotao
          :rotulo="t('onboarding.cliente.importar')"
          :desabilitado="ocupado || !cliente.origem || execucaoAtiva(execucao)"
          :confirmacao="t('onboarding.cliente.confirmaImportar', { codigo: cliente.codigo })"
          data-testid="onb-importar"
          @acionar="executar('importar')"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('onboarding.cliente.sincronizar')"
          :desabilitado="ocupado || !cliente.origem || !podeSincronizar || execucaoAtiva(execucao)"
          :confirmacao="t('onboarding.cliente.confirmaSincronizar', { codigo: cliente.codigo })"
          data-testid="onb-sincronizar"
          @acionar="executar('sincronizar')"
        />
        <SanteBotao variante="texto" :rotulo="t('onboarding.cliente.fechar')" @acionar="aberto = null" />
      </div>
      <p v-if="!cliente.origem" class="secundario">{{ t('onboarding.cliente.semVinculo') }}</p>

      <section v-if="execucao" class="bloco" aria-labelledby="onb-exec" data-testid="onb-execucao">
        <h3 id="onb-exec">
          {{
            t('onboarding.execucao.titulo', {
              id: execucao.id,
              tipo: t(`onboarding.tipos.${execucao.tipo}`),
            })
          }}:
          {{ t(`onboarding.estados.${execucao.estado}`) }}
        </h3>
        <progress
          :value="execucao.percentual"
          max="100"
          :aria-label="t('onboarding.execucao.progresso')"
          data-testid="onb-progresso"
        >
          {{ execucao.percentual }}%
        </progress>
        <span> {{ execucao.percentual }}%</span>
        <p v-if="execucao.etapa">{{ t('onboarding.execucao.etapa', { etapa: execucao.etapa }) }}</p>
        <SanteAlerta
          v-if="execucao.estado === 'falhou'"
          :texto="t('onboarding.execucao.falhou', { motivo: execucao.motivoFalha ?? '' })"
        />
        <p v-if="execucao.arquivoInalterado">{{ t('onboarding.execucao.arquivoInalterado') }}</p>
        <p v-if="execucao.registrosLidos !== null">
          {{
            t('onboarding.execucao.registrosLidos', { n: execucao.registrosLidos.toLocaleString('pt-BR') })
          }}
        </p>
        <table v-if="execucao.entidades.length" class="tabela" data-testid="onb-conciliacao">
          <caption>
            {{
              t('onboarding.execucao.conciliacao')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('onboarding.execucao.entidade') }}</th>
              <th scope="col">{{ t('onboarding.execucao.origem') }}</th>
              <th scope="col">{{ t('onboarding.execucao.destino') }}</th>
              <th scope="col">{{ t('onboarding.execucao.recusados') }}</th>
              <th scope="col">{{ t('onboarding.execucao.conferido') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in execucao.entidades" :key="e.entidade">
              <td>{{ rotuloEntidade(e.entidade) }}</td>
              <td>{{ e.registrosOrigem.toLocaleString('pt-BR') }}</td>
              <td>{{ e.registrosDestino.toLocaleString('pt-BR') }}</td>
              <td>{{ e.recusados.toLocaleString('pt-BR') }}</td>
              <td>{{ e.conferido ? t('onboarding.execucao.sim') : t('onboarding.execucao.nao') }}</td>
            </tr>
          </tbody>
        </table>
        <template v-if="execucao.sincronizar">
          <h4>{{ t('onboarding.sincronizar.titulo') }}</h4>
          <p data-testid="onb-sinc-resumo">{{ t('onboarding.sincronizar.resumo', execucao.sincronizar) }}</p>
          <SanteAlerta
            v-for="a in execucao.sincronizar.alertasExclusaoEmMassa"
            :key="`massa:${a.entidade}`"
            variante="alerta"
            :texto="t('onboarding.sincronizar.massa', { ...a, entidade: rotuloEntidade(a.entidade) })"
          />
          <SanteBotao
            v-if="execucao.sincronizar.alertasExclusaoEmMassa.length"
            variante="secundario"
            :rotulo="t('onboarding.sincronizar.confirmarMassa')"
            :desabilitado="ocupado || !cliente.origem || execucaoAtiva(execucao)"
            :confirmacao="
              t('onboarding.sincronizar.confirmaMassa', {
                apagadas: execucao.sincronizar.alertasExclusaoEmMassa.reduce((n, a) => n + a.apagadas, 0),
                codigo: cliente.codigo,
              })
            "
            data-testid="onb-confirmar-massa"
            @acionar="executar('sincronizar', true)"
          />
          <SanteAlerta
            v-if="execucao.sincronizar.exclusoesSemSuporte"
            variante="alerta"
            :texto="t('onboarding.sincronizar.semSuporte', { n: execucao.sincronizar.exclusoesSemSuporte })"
            data-testid="onb-sem-suporte"
          />
          <table v-if="execucao.sincronizar.conflitosItens.length" class="tabela" data-testid="onb-conflitos">
            <caption>
              {{
                t('onboarding.sincronizar.conflitos')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('onboarding.execucao.entidade') }}</th>
                <th scope="col">{{ t('onboarding.sincronizar.registro') }}</th>
                <th scope="col">{{ t('onboarding.sincronizar.colunas') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in execucao.sincronizar.conflitosItens" :key="`${c.tabelaDestino}:${c.idDestino}`">
                <td>{{ rotuloEntidade(c.tabelaDestino) }}</td>
                <td>{{ c.idDestino }}</td>
                <td>{{ c.colunas.join(', ') }}</td>
              </tr>
            </tbody>
          </table>
        </template>
        <template v-if="execucao.pendencias.total">
          <h4>{{ t('onboarding.execucao.pendencias', execucao.pendencias) }}</h4>
          <table class="tabela" data-testid="onb-pendencias">
            <thead>
              <tr>
                <th scope="col">{{ t('onboarding.execucao.entidade') }}</th>
                <th scope="col">{{ t('onboarding.execucao.regra') }}</th>
                <th scope="col">{{ t('onboarding.execucao.gravidade') }}</th>
                <th scope="col">{{ t('onboarding.execucao.quantidade') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in execucao.pendencias.porRegra" :key="`${p.entidade}:${p.regra}:${p.gravidade}`">
                <td>{{ rotuloEntidade(p.entidade) }}</td>
                <td>{{ p.regra.replace(/_/g, ' ') }}</td>
                <td>{{ t(`onboarding.gravidades.${p.gravidade}`) }}</td>
                <td>{{ p.quantidade.toLocaleString('pt-BR') }}</td>
              </tr>
            </tbody>
          </table>
        </template>
        <RelatorioExecucao :codigo="cliente.codigo" :execucao="execucao" />
      </section>
      <table v-if="historico.length" class="tabela" data-testid="onb-historico">
        <caption>
          {{
            t('onboarding.historico.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('onboarding.historico.execucao') }}</th>
            <th scope="col">{{ t('onboarding.historico.tipo') }}</th>
            <th scope="col">{{ t('onboarding.historico.estado') }}</th>
            <th scope="col">{{ t('onboarding.historico.concluida') }}</th>
            <th scope="col">{{ t('onboarding.historico.conflitos') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in historico" :key="h.id">
            <td>{{ h.id }}</td>
            <td>{{ t(`onboarding.tipos.${h.tipo}`) }}</td>
            <td>{{ t(`onboarding.estados.${h.estado}`) }}</td>
            <td>{{ h.concluidoEm ? new Date(h.concluidoEm).toLocaleString('pt-BR') : '' }}</td>
            <td>{{ h.sincronizar ? h.sincronizar.conflitos : '' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="bloco" aria-labelledby="onb-novo" data-testid="onb-novo">
      <h2 id="onb-novo">{{ t('onboarding.novo.titulo') }}</h2>
      <SanteCampoTexto v-model="codigo" :rotulo="t('onboarding.novo.codigo')" :max-bytes="40" obrigatorio />
      <p v-if="codigo && !codigoValido" class="secundario" role="status">
        {{ t('onboarding.novo.codigoInvalido') }}
      </p>
      <SanteCampoTexto v-model="nome" :rotulo="t('onboarding.novo.nome')" :max-bytes="150" obrigatorio />
      <SanteBotao
        :rotulo="t('onboarding.novo.criar')"
        :desabilitado="ocupado || !codigoValido || !nome.trim()"
        data-testid="onb-criar"
        @acionar="criar"
      />
    </section>
  </section>
</template>

<style scoped>
.tela-onboarding {
  display: grid;
  gap: var(--sgh-espaco-3, 0.75rem);
  max-width: 72rem;
}
.tabela {
  border-collapse: collapse;
  width: 100%;
}
.tabela th,
.tabela td {
  border-bottom: 1px solid var(--sgh-borda, #ccc);
  padding: 0.25rem 0.5rem;
  text-align: left;
}
.origens {
  display: grid;
  gap: 0.5rem;
  list-style: none;
  padding: 0;
}
.origens li,
.acoes {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.secundario {
  color: var(--sgh-texto-secundario, #555);
}
progress {
  width: min(32rem, 100%);
}
.sr-only {
  clip: rect(0 0 0 0);
  height: 1px;
  overflow: hidden;
  position: absolute;
  width: 1px;
}
</style>
