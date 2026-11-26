<!-- 08-SGO L114 (C3-027): gestão dos portais externos pela operadora. Contas do portal do beneficiário, da contratante
     e do corretor (convite, ativação com os termos, bloqueio com motivo, desbloqueio e encerramento), fila das
     solicitações (analisar, pedir documento, aprovar, reprovar e concluir) e os lotes de exclusão da contratante (linhas
     criticadas e processamento). Toda mudança leva a versão lida; as regras ficam no domínio e no servidor. -->
<script setup lang="ts">
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import {
  type AcaoConta,
  type AcaoDecisao,
  type ContaPortal,
  type LoteExclusao,
  SITUACOES_CONTA,
  SITUACOES_SOLICITACAO,
  type SolicitacaoPortal,
  TIPOS_PORTAL,
  type TipoPortal,
  convidarConta,
  decidirSolicitacao,
  lerCanal,
  lerContas,
  lerItensLote,
  lerLotes,
  lerSolicitacoes,
  mudarSituacaoConta,
  processarLote,
} from '../api-portais-operadora.js';
import { mensagensPortaisOperadora } from '../i18n-portais-operadora.js';

const { t } = useI18n({ useScope: 'local', messages: { 'pt-BR': mensagensPortaisOperadora } });
const podeEditar = computed(() => pode('operadora.beneficiario.editar'));
const fila = useQueryClient();
const dataBr = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const num = (v: string) => (v.trim() === '' ? null : Number(v));

const aba = ref<'contas' | 'solicitacoes' | 'lotes'>('contas');
const mensagem = ref<string | null>(null);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
function tratar(e: unknown): void {
  if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409, 422].includes(e.status))
    recusa.value = e.problema.detail;
  else erro.value = e;
}
async function gravar(acao: () => Promise<unknown>, chave: string[]): Promise<boolean> {
  mensagem.value = recusa.value = erro.value = null;
  try {
    await acao();
    mensagem.value = t('gravado');
    await fila.invalidateQueries({ queryKey: chave });
    return true;
  } catch (e) {
    tratar(e);
    return false;
  }
}

const canal = useQuery({ queryKey: ['operadora', 'portais', 'canal'], queryFn: lerCanal });

// ---- contas ----
const portal = ref<string>('beneficiario');
const sitConta = ref<string>('');
const opcoesPortal = TIPOS_PORTAL.map((p) => ({ valor: p as string, rotulo: t(`portais.${p}`) }));
const opcoesSitConta = [
  { valor: '', rotulo: t('todas') },
  ...SITUACOES_CONTA.map((s) => ({ valor: s as string, rotulo: t(`situacoesConta.${s}`) })),
];
const contas = useQuery({
  queryKey: computed(() => ['operadora', 'portais', 'contas', portal.value, sitConta.value]),
  queryFn: () => lerContas(portal.value as TipoPortal, sitConta.value || null),
});
const convite = reactive({
  login: '',
  email: '',
  celular: '',
  usuario: '',
  titular: '',
  gestor: '',
  vendedor: '',
});
const faltaConvite = computed(() => {
  const f: string[] = [];
  if (!convite.login.trim()) f.push(t('conta.login'));
  if (!convite.titular.trim()) f.push(t('conta.titular'));
  return f;
});
async function convidar(): Promise<void> {
  const p = portal.value as TipoPortal;
  const titular = num(convite.titular);
  const ok = await gravar(
    () =>
      convidarConta(p, {
        login: convite.login.trim(),
        email: convite.email.trim() || null,
        celular: convite.celular.trim() || null,
        usuario: num(convite.usuario),
        beneficiario: p === 'beneficiario' ? titular : null,
        contratante: p === 'contratante' ? titular : null,
        gestor: p === 'contratante' ? num(convite.gestor) : null,
        corretora: p === 'corretor' ? titular : null,
        vendedor: p === 'corretor' ? num(convite.vendedor) : null,
      }),
    ['operadora', 'portais', 'contas'],
  );
  if (ok)
    Object.assign(convite, {
      login: '',
      email: '',
      celular: '',
      usuario: '',
      titular: '',
      gestor: '',
      vendedor: '',
    });
}
const rotuloTitular = computed(() =>
  portal.value === 'beneficiario'
    ? t('conta.beneficiario')
    : portal.value === 'contratante'
      ? t('conta.contratante')
      : t('conta.corretora'),
);
const motivoBloqueio = reactive<Record<number, string>>({});
const termos = reactive<Record<number, boolean>>({});
watch(
  () => contas.data.value,
  (l) => {
    for (const c of l ?? []) {
      motivoBloqueio[c.id] ??= '';
      termos[c.id] ??= false;
    }
  },
  { immediate: true },
);
const titularDe = (c: ContaPortal) =>
  [c.beneficiario, c.contratante, c.gestor, c.corretora, c.vendedor].filter((x) => x !== null).join(' / ');
function acaoConta(c: ContaPortal, acao: AcaoConta): Promise<boolean> {
  return gravar(
    () =>
      mudarSituacaoConta(c.portal, c.id, {
        versao: c.versao,
        acao,
        motivo: acao === 'bloquear' ? (motivoBloqueio[c.id] ?? '').trim() || null : null,
        termosAceitos: acao === 'ativar' ? termos[c.id] === true : false,
      }),
    ['operadora', 'portais', 'contas'],
  );
}

// ---- solicitações ----
const sitSolic = ref<string>('');
const opcoesSitSolic = [
  { valor: '', rotulo: t('todas') },
  ...SITUACOES_SOLICITACAO.map((s) => ({ valor: s as string, rotulo: t(`situacoesSolicitacao.${s}`) })),
];
const solicitacoes = useQuery({
  queryKey: computed(() => ['operadora', 'portais', 'solicitacoes', sitSolic.value]),
  queryFn: () => lerSolicitacoes(sitSolic.value || null),
  enabled: computed(() => aba.value === 'solicitacoes'),
});
const resultado = reactive<Record<number, string>>({});
watch(
  () => solicitacoes.data.value,
  (l) => {
    for (const s of l ?? []) resultado[s.id] ??= '';
  },
  { immediate: true },
);
const ABERTAS = ['aberta', 'em_analise', 'pendente_documento'];
function decidir(s: SolicitacaoPortal, acao: AcaoDecisao): Promise<boolean> {
  return gravar(
    () =>
      decidirSolicitacao(s.id, { versao: s.versao, acao, resultado: (resultado[s.id] ?? '').trim() || null }),
    ['operadora', 'portais', 'solicitacoes'],
  );
}
const rotuloTipo = (tipo: string) => t(`tipos.${tipo}`);

// ---- lotes ----
const lotes = useQuery({
  queryKey: ['operadora', 'portais', 'lotes'],
  queryFn: lerLotes,
  enabled: computed(() => aba.value === 'lotes'),
});
const loteAberto = ref<LoteExclusao | null>(null);
const itens = useQuery({
  queryKey: computed(() => ['operadora', 'portais', 'lotes', 'itens', loteAberto.value?.id]),
  queryFn: () => lerItensLote(loteAberto.value!.id),
  enabled: computed(() => loteAberto.value !== null),
});
async function processar(l: LoteExclusao): Promise<void> {
  if (await gravar(() => processarLote(l.id, l.versao), ['operadora', 'portais', 'lotes']))
    loteAberto.value = null;
}
</script>

<template>
  <main class="tela" data-testid="tela-portais-operadora">
    <h1>{{ t('titulo') }}</h1>
    <p>{{ t('ajuda') }}</p>
    <SanteAlerta
      v-if="canal.data.value && !canal.data.value.ligado"
      :texto="t('canalDesligado', { decisao: canal.data.value.decisao })"
      variante="info"
      data-testid="portais-canal"
    />
    <p v-if="!podeEditar" role="status">{{ t('somenteLeitura') }}</p>
    <div class="abas" role="group" :aria-label="t('titulo')">
      <SanteBotao
        v-for="a in ['contas', 'solicitacoes', 'lotes'] as const"
        :key="a"
        :rotulo="t(`abas.${a}`)"
        :variante="aba === a ? 'primario' : 'secundario'"
        :data-testid="`portais-aba-${a}`"
        @acionar="aba = a"
      />
    </div>
    <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" data-testid="portais-mensagem" />
    <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" data-testid="portais-recusa" />
    <MensagemErro v-if="erro" :erro="erro" />

    <section
      v-if="aba === 'contas'"
      class="bloco"
      aria-labelledby="portais-contas-t"
      data-testid="portais-contas"
    >
      <h2 id="portais-contas-t">{{ t('abas.contas') }}</h2>
      <div class="campos">
        <SanteSelecao
          v-model="portal"
          :rotulo="t('portal')"
          :opcoes="opcoesPortal"
          data-testid="portais-portal"
        />
        <SanteSelecao
          v-model="sitConta"
          :rotulo="t('situacao')"
          :opcoes="opcoesSitConta"
          data-testid="portais-conta-situacao"
        />
      </div>
      <table v-if="contas.data.value?.length" class="tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('conta.login') }}</th>
            <th scope="col">{{ t('conta.titular') }}</th>
            <th scope="col">{{ t('situacao') }}</th>
            <th scope="col">{{ t('conta.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in contas.data.value" :key="c.id" :data-testid="`portais-conta-${c.id}`">
            <td>{{ c.login }}</td>
            <td>{{ titularDe(c) }}</td>
            <td>
              {{ t(`situacoesConta.${c.situacao}`) }}
              <span v-if="c.motivoBloqueio"> ({{ c.motivoBloqueio }})</span>
            </td>
            <td class="acoes">
              <template v-if="podeEditar">
                <template v-if="c.situacao === 'convidada'">
                  <label>
                    <input v-model="termos[c.id]" type="checkbox" :data-testid="`portais-termos-${c.id}`" />
                    {{ t('conta.termos') }}
                  </label>
                  <SanteBotao
                    :rotulo="t('conta.ativar')"
                    :desabilitado="!termos[c.id]"
                    :data-testid="`portais-ativar-${c.id}`"
                    @acionar="acaoConta(c, 'ativar')"
                  />
                </template>
                <template v-if="c.situacao === 'ativa'">
                  <SanteCampoTexto
                    :id="`portais-motivo-${c.id}`"
                    :model-value="motivoBloqueio[c.id] ?? ''"
                    @update:model-value="(v: string) => (motivoBloqueio[c.id] = v)"
                    :rotulo="t('conta.motivo')"
                    :max-bytes="200"
                  />
                  <SanteBotao
                    :rotulo="t('conta.bloquear')"
                    variante="secundario"
                    :desabilitado="!(motivoBloqueio[c.id] ?? '').trim()"
                    :data-testid="`portais-bloquear-${c.id}`"
                    @acionar="acaoConta(c, 'bloquear')"
                  />
                </template>
                <SanteBotao
                  v-if="c.situacao === 'bloqueada'"
                  :rotulo="t('conta.desbloquear')"
                  :data-testid="`portais-desbloquear-${c.id}`"
                  @acionar="acaoConta(c, 'desbloquear')"
                />
                <SanteBotao
                  v-if="c.situacao !== 'encerrada'"
                  :rotulo="t('conta.encerrar')"
                  variante="destrutivo"
                  :confirmacao="t('conta.confirmarEncerrar')"
                  :data-testid="`portais-encerrar-${c.id}`"
                  @acionar="acaoConta(c, 'encerrar')"
                />
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="contas.data.value" role="status">{{ t('nenhum') }}</p>

      <form v-if="podeEditar" class="bloco" aria-labelledby="portais-nova-t" @submit.prevent="convidar">
        <h3 id="portais-nova-t">{{ t('conta.novaTitulo') }}</h3>
        <div class="campos">
          <SanteCampoTexto
            id="portais-login"
            v-model="convite.login"
            :rotulo="t('conta.login')"
            :max-bytes="254"
            obrigatorio
          />
          <SanteCampoTexto
            id="portais-email"
            v-model="convite.email"
            :rotulo="t('conta.email')"
            :max-bytes="254"
          />
          <SanteCampoTexto
            id="portais-celular"
            v-model="convite.celular"
            :rotulo="t('conta.celular')"
            :max-bytes="20"
          />
          <SanteCampoTexto
            id="portais-titular"
            v-model="convite.titular"
            :rotulo="rotuloTitular"
            :max-bytes="18"
            obrigatorio
          />
          <SanteCampoTexto
            v-if="portal === 'contratante'"
            id="portais-gestor"
            v-model="convite.gestor"
            :rotulo="t('conta.gestor')"
            :max-bytes="18"
          />
          <SanteCampoTexto
            v-if="portal === 'corretor'"
            id="portais-vendedor"
            v-model="convite.vendedor"
            :rotulo="t('conta.vendedor')"
            :max-bytes="18"
          />
          <SanteCampoTexto
            id="portais-usuario"
            v-model="convite.usuario"
            :rotulo="t('conta.usuario')"
            :max-bytes="18"
          />
        </div>
        <p v-if="faltaConvite.length" role="status">{{ t('falta', { lista: faltaConvite.join(', ') }) }}</p>
        <SanteBotao
          :rotulo="t('conta.convidar')"
          tipo="submit"
          :desabilitado="faltaConvite.length > 0"
          data-testid="portais-convidar"
        />
      </form>
    </section>

    <section
      v-if="aba === 'solicitacoes'"
      class="bloco"
      aria-labelledby="portais-solic-t"
      data-testid="portais-solicitacoes"
    >
      <h2 id="portais-solic-t">{{ t('abas.solicitacoes') }}</h2>
      <SanteSelecao
        v-model="sitSolic"
        :rotulo="t('situacao')"
        :opcoes="opcoesSitSolic"
        data-testid="portais-solic-situacao"
      />
      <table v-if="solicitacoes.data.value?.length" class="tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('solicitacao.numero') }}</th>
            <th scope="col">{{ t('solicitacao.tipo') }}</th>
            <th scope="col">{{ t('solicitacao.beneficiario') }}</th>
            <th scope="col">{{ t('solicitacao.dataEfeito') }}</th>
            <th scope="col">{{ t('situacao') }}</th>
            <th scope="col">{{ t('solicitacao.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in solicitacoes.data.value" :key="s.id" :data-testid="`portais-solic-${s.id}`">
            <td>{{ s.numero }}</td>
            <td>{{ rotuloTipo(s.tipo) }}</td>
            <td>{{ s.beneficiarioNome ?? '—' }}</td>
            <td>{{ dataBr(s.dataEfeito) }}</td>
            <td>
              {{ t(`situacoesSolicitacao.${s.situacao}`) }}
              <span v-if="s.resultado"> ({{ s.resultado }})</span>
            </td>
            <td class="acoes">
              <template v-if="podeEditar && (ABERTAS.includes(s.situacao) || s.situacao === 'aprovada')">
                <SanteCampoTexto
                  :id="`portais-resultado-${s.id}`"
                  :model-value="resultado[s.id] ?? ''"
                  @update:model-value="(v: string) => (resultado[s.id] = v)"
                  :rotulo="t('solicitacao.resultado')"
                  :max-bytes="1000"
                />
                <template v-if="ABERTAS.includes(s.situacao)">
                  <SanteBotao
                    v-if="s.situacao === 'aberta'"
                    :rotulo="t('solicitacao.analisar')"
                    variante="secundario"
                    :data-testid="`portais-analisar-${s.id}`"
                    @acionar="decidir(s, 'analisar')"
                  />
                  <SanteBotao
                    :rotulo="t('solicitacao.pedirDocumento')"
                    variante="secundario"
                    :data-testid="`portais-documento-${s.id}`"
                    @acionar="decidir(s, 'pedir_documento')"
                  />
                  <SanteBotao
                    :rotulo="t('solicitacao.aprovar')"
                    :data-testid="`portais-aprovar-${s.id}`"
                    @acionar="decidir(s, 'aprovar')"
                  />
                  <SanteBotao
                    :rotulo="t('solicitacao.reprovar')"
                    variante="destrutivo"
                    :confirmacao="t('solicitacao.confirmarReprovar')"
                    :desabilitado="!(resultado[s.id] ?? '').trim()"
                    :data-testid="`portais-reprovar-${s.id}`"
                    @acionar="decidir(s, 'reprovar')"
                  />
                </template>
                <SanteBotao
                  v-else
                  :rotulo="t('solicitacao.concluir')"
                  :data-testid="`portais-concluir-${s.id}`"
                  @acionar="decidir(s, 'concluir')"
                />
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="solicitacoes.data.value" role="status">{{ t('nenhum') }}</p>
    </section>

    <section
      v-if="aba === 'lotes'"
      class="bloco"
      aria-labelledby="portais-lotes-t"
      data-testid="portais-lotes"
    >
      <h2 id="portais-lotes-t">{{ t('abas.lotes') }}</h2>
      <table v-if="lotes.data.value?.length" class="tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('lote.numero') }}</th>
            <th scope="col">{{ t('lote.contratante') }}</th>
            <th scope="col">{{ t('situacao') }}</th>
            <th scope="col">{{ t('lote.registros') }}</th>
            <th scope="col">{{ t('lote.aceitos') }}</th>
            <th scope="col">{{ t('lote.rejeitados') }}</th>
            <th scope="col">{{ t('lote.recebidoEm') }}</th>
            <th scope="col">{{ t('solicitacao.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in lotes.data.value" :key="l.id" :data-testid="`portais-lote-${l.id}`">
            <td>{{ l.numero }}</td>
            <td>{{ l.contratante }}</td>
            <td>{{ l.situacao }}</td>
            <td>{{ l.registros }}</td>
            <td>{{ l.aceitos }}</td>
            <td>{{ l.rejeitados }}</td>
            <td>{{ dataBr(l.recebidoEm) }}</td>
            <td class="acoes">
              <SanteBotao
                :rotulo="t('lote.itens')"
                variante="secundario"
                :data-testid="`portais-lote-itens-${l.id}`"
                @acionar="loteAberto = l"
              />
              <SanteBotao
                v-if="podeEditar && !l.processadoEm && l.aceitos > 0"
                :rotulo="t('lote.processar')"
                variante="destrutivo"
                :confirmacao="t('lote.confirmarProcessar')"
                :data-testid="`portais-lote-processar-${l.id}`"
                @acionar="processar(l)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="lotes.data.value" role="status">{{ t('nenhum') }}</p>
      <template v-if="loteAberto && itens.data.value">
        <h3>{{ t('lote.linhasDoLote', { numero: loteAberto.numero }) }}</h3>
        <table class="tabela" data-testid="portais-lote-linhas">
          <thead>
            <tr>
              <th scope="col">{{ t('lote.sequencia') }}</th>
              <th scope="col">{{ t('lote.matricula') }}</th>
              <th scope="col">{{ t('lote.nome') }}</th>
              <th scope="col">{{ t('situacao') }}</th>
              <th scope="col">{{ t('lote.critica') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in itens.data.value" :key="i.sequencia">
              <td>{{ i.sequencia }}</td>
              <td>{{ i.matricula ?? '—' }}</td>
              <td>{{ i.nome }}</td>
              <td>{{ i.situacao }}</td>
              <td>{{ i.critica ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>
  </main>
</template>

<style scoped>
.tela {
  display: grid;
  gap: 1rem;
  padding: 1rem;
}
.abas,
.campos,
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
.tabela {
  width: 100%;
  border-collapse: collapse;
}
</style>
