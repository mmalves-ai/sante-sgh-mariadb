<script setup lang="ts">
// Mensagens internas e comunicados (ficha do M27, seção 7; regras 7 e 8; cap-08 §8.13): `/mensagens`. As recebidas (a
// primeira abertura marca a leitura; a ciência obrigatória pede o botão), as enviadas (com as contagens de leitura e de
// ciência), a nova mensagem para usuários, perfis, setores ou unidades, o comunicado com vigência (gestor) e as
// mensagens antigas recebidas no outro sistema (só consulta). Regra 7: o texto não leva dado do paciente (a tela e o
// servidor recusam CPF, cartão do SUS, número de prontuário ou de atendimento); o paciente entra como o atendimento de
// contexto, e o link abre o prontuário pela permissão de quem lê. O conteúdo nunca vai para a trilha (só o evento).
import { type DestinoMensagem, TIPOS_DESTINO_MENSAGEM, type TipoDestinoMensagem } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import { pode } from '../../../casca/sessao/pode.js';
import { dataBr } from '../../agenda/formato.js';
import { dataHoraDe } from '../../recepcao/formato.js';
import {
  abrirMensagem,
  darCiencia,
  enviarMensagem,
  lerAnteriores,
  lerCaixa,
  novaChave,
  publicarComunicado,
  donoDaSessao,
} from '../api-inicio.js';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import ComunicadoGestao from '../componentes/ComunicadoGestao.vue';
import ErroTrabalho from '../componentes/ErroTrabalho.vue';
import {
  adicionarDestino,
  type ErrosDoFormulario,
  validarComunicado,
  validarMensagem,
} from '../regras-tela.js';

type Aba = 'recebidas' | 'enviadas' | 'nova' | 'comunicado' | 'anteriores';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const podeEnviar = computed(() => pode('acesso.mensagem.enviar'));
const podePublicar = computed(() => pode('acesso.comunicado.publicar'));
const podeAnteriores = computed(() => pode('acesso.mensagemAnterior.ler'));
const abas = computed<Aba[]>(() => [
  'recebidas',
  'enviadas',
  ...(podeEnviar.value ? (['nova'] as const) : []),
  ...(podePublicar.value ? (['comunicado'] as const) : []),
  ...(podeAnteriores.value ? (['anteriores'] as const) : []),
]);
const aba = ref<Aba>('recebidas');

const { sessao } = usarSessao();
const dono = computed(() => donoDaSessao(sessao.value));
const caixa = useQuery({
  queryKey: computed(() => ['mensagens', 'caixa', dono.value]),
  queryFn: () => lerCaixa(),
  refetchInterval: 30_000,
});
const anteriores = useQuery({
  queryKey: computed(() => ['mensagens', 'anteriores', dono.value]),
  queryFn: () => lerAnteriores(),
  enabled: computed(() => aba.value === 'anteriores'),
});

// ── Abrir e dar ciência ──────────────────────────────────────────────────────────────────────────────
const aberta = ref<number | null>(null);
const leitura = useQuery({
  queryKey: computed(() => ['mensagens', 'abrir', aberta.value, dono.value]),
  queryFn: async () => {
    const m = await abrirMensagem(aberta.value as number);
    void cliente.invalidateQueries({ queryKey: ['mensagens', 'caixa'] });
    void cliente.invalidateQueries({ queryKey: ['avisos'] });
    return m;
  },
  enabled: computed(() => aberta.value !== null),
});
const abrirDaRota = () => {
  const a = Number(rota.query['abrir']);
  if (Number.isInteger(a) && a > 0) {
    aba.value = 'recebidas';
    aberta.value = a;
  }
};
watch(() => rota.query['abrir'], abrirDaRota, { immediate: true });
// W0-09: o comunicado enviado aberto para gestão (detalhe, corrigir, encurtar, encerrar).
const gerido = ref<number | null>(null);
const erroAcao = ref<unknown>(null);
const aviso = ref<string | null>(null);
const ocupado = ref(false);
async function ciencia(id: number): Promise<void> {
  ocupado.value = true;
  erroAcao.value = null;
  try {
    await darCiencia(id, novaChave('ciencia'));
    aviso.value = t('trabalho.mensagens.cienciaFeita');
    await Promise.all([
      cliente.invalidateQueries({ queryKey: ['mensagens'] }),
      cliente.invalidateQueries({ queryKey: ['avisos'] }),
    ]);
  } catch (e) {
    erroAcao.value = e;
  } finally {
    ocupado.value = false;
  }
}

// ── Nova mensagem e comunicado ───────────────────────────────────────────────────────────────────────
const assunto = ref('');
const texto = ref('');
const destinos = ref<DestinoMensagem[]>([]);
const tipoDestino = ref<TipoDestinoMensagem>('usuario');
const valorDestino = ref('');
const cienciaObrigatoria = ref(false);
const contexto = ref('');
const vigenciaInicio = ref('');
const vigenciaFim = ref('');
const erros = ref<ErrosDoFormulario>({});
const tiposDestino = computed(() =>
  TIPOS_DESTINO_MENSAGEM.map((v) => ({ valor: v, rotulo: t(`trabalho.mensagens.tiposDestino.${v}`) })),
);
function addDestino(): void {
  destinos.value = adicionarDestino(destinos.value, tipoDestino.value, valorDestino.value);
  valorDestino.value = '';
}
function tirar(i: number): void {
  destinos.value = destinos.value.filter((_, j) => j !== i);
}
function limpar(): void {
  assunto.value = '';
  texto.value = '';
  destinos.value = [];
  cienciaObrigatoria.value = aba.value === 'comunicado';
  contexto.value = '';
  vigenciaInicio.value = '';
  vigenciaFim.value = '';
  erros.value = {};
}
watch(aba, () => {
  erroAcao.value = null;
  aviso.value = null;
  if (aba.value === 'nova' || aba.value === 'comunicado') limpar();
});
let chaveEnvio: string | null = null;
async function enviar(): Promise<void> {
  erroAcao.value = null;
  aviso.value = null;
  const base = {
    assunto: assunto.value,
    texto: texto.value,
    destinos: destinos.value,
    cienciaObrigatoria: cienciaObrigatoria.value,
    contexto: contexto.value,
  };
  const v =
    aba.value === 'comunicado'
      ? validarComunicado({ ...base, vigenciaInicio: vigenciaInicio.value, vigenciaFim: vigenciaFim.value })
      : validarMensagem(base);
  if (!v.ok) {
    erros.value = v.erros;
    return;
  }
  erros.value = {};
  ocupado.value = true;
  chaveEnvio ??= novaChave(aba.value);
  try {
    const r =
      aba.value === 'comunicado'
        ? await publicarComunicado(v.valor as Parameters<typeof publicarComunicado>[0], chaveEnvio)
        : await enviarMensagem(v.valor as Parameters<typeof enviarMensagem>[0], chaveEnvio);
    chaveEnvio = null;
    const feito = t(
      aba.value === 'comunicado' ? 'trabalho.mensagens.publicado' : 'trabalho.mensagens.enviada',
      { n: r.destinatarios },
    );
    await cliente.invalidateQueries({ queryKey: ['mensagens'] });
    aba.value = 'enviadas';
    // A troca de aba limpa o aviso anterior (no próximo ciclo); o de agora vem depois dela.
    await nextTick();
    aviso.value = feito;
  } catch (e) {
    erroAcao.value = e;
  } finally {
    ocupado.value = false;
  }
}
const situacao = (m: { lidaEm: string | null; cienciaObrigatoria: boolean; cienciaEm: string | null }) =>
  m.cienciaObrigatoria
    ? m.cienciaEm
      ? t('trabalho.mensagens.cienciaDada')
      : t('trabalho.mensagens.cienciaPendente')
    : m.lidaEm
      ? t('trabalho.mensagens.lida')
      : t('trabalho.mensagens.naoLida');
</script>

<template>
  <section class="tela-agenda" aria-labelledby="msg-titulo" data-testid="tela-mensagens">
    <h1 id="msg-titulo">{{ t('trabalho.mensagens.titulo') }}</h1>
    <p>{{ t('trabalho.mensagens.texto') }}</p>
    <div class="abas" role="tablist" :aria-label="t('trabalho.mensagens.abasRotulo')">
      <button
        v-for="a in abas"
        :id="`aba-${a}`"
        :key="a"
        type="button"
        role="tab"
        class="aba"
        :aria-selected="aba === a"
        :aria-controls="`painel-${a}`"
        :tabindex="aba === a ? 0 : -1"
        :data-testid="`aba-${a}`"
        @click="aba = a"
      >
        {{ t(`trabalho.mensagens.abas.${a}`) }}
        <template v-if="a === 'recebidas' && caixa.data.value && caixa.data.value.naoLidas > 0">
          ({{ caixa.data.value.naoLidas }})</template
        >
      </button>
    </div>
    <p v-if="aviso" role="status" class="painel" data-testid="msg-aviso">{{ aviso }}</p>
    <ErroTrabalho v-if="erroAcao" :erro="erroAcao" />

    <!-- Recebidas -->
    <div
      v-if="aba === 'recebidas'"
      id="painel-recebidas"
      role="tabpanel"
      aria-labelledby="aba-recebidas"
      class="painel-aba"
    >
      <ErroTrabalho v-if="caixa.isError.value" :erro="caixa.error.value" />
      <p v-else-if="!caixa.data.value" role="status">{{ t('trabalho.carregando') }}</p>
      <template v-else>
        <p v-if="caixa.data.value.recebidas.length === 0">{{ t('trabalho.mensagens.recebidasVazio') }}</p>
        <table v-else class="tabela" data-testid="tabela-recebidas">
          <caption class="sgh-visualmente-oculto">
            {{
              t('trabalho.mensagens.abas.recebidas')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('trabalho.mensagens.assunto') }}</th>
              <th scope="col">{{ t('trabalho.mensagens.de') }}</th>
              <th scope="col">{{ t('trabalho.mensagens.via') }}</th>
              <th scope="col">{{ t('trabalho.mensagens.em') }}</th>
              <th scope="col">{{ t('trabalho.mensagens.situacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in caixa.data.value.recebidas"
              :key="m.id"
              :class="{ nova: m.lidaEm === null }"
              :data-testid="`recebida-${m.id}`"
            >
              <td>
                <button type="button" class="link" :data-testid="`abrir-${m.id}`" @click="aberta = m.id">
                  <span v-if="m.tipo === 'comunicado'" class="chip">{{
                    t('trabalho.mensagens.comunicado')
                  }}</span>
                  {{ m.assunto }}
                </button>
              </td>
              <td>{{ m.remetente }}</td>
              <td>{{ m.via }}</td>
              <td>{{ dataHoraDe(m.enviadaEm) }}</td>
              <td>{{ situacao(m) }}</td>
            </tr>
          </tbody>
        </table>
        <article
          v-if="aberta !== null"
          class="painel"
          data-testid="mensagem-aberta"
          aria-labelledby="msg-aberta-titulo"
        >
          <ErroTrabalho v-if="leitura.isError.value" :erro="leitura.error.value" />
          <p v-else-if="!leitura.data.value" role="status">{{ t('trabalho.carregando') }}</p>
          <template v-else>
            <h2 id="msg-aberta-titulo">{{ leitura.data.value.assunto }}</h2>
            <p class="secundario">
              {{ t('trabalho.mensagens.de') }} {{ leitura.data.value.remetente }} ·
              {{ dataHoraDe(leitura.data.value.enviadaEm) }} · {{ leitura.data.value.via }}
            </p>
            <p v-if="leitura.data.value.vigenciaInicio && leitura.data.value.vigenciaFim" class="secundario">
              {{
                t('trabalho.mensagens.vigencia', {
                  de: dataBr(leitura.data.value.vigenciaInicio),
                  ate: dataBr(leitura.data.value.vigenciaFim),
                })
              }}
            </p>
            <p v-if="leitura.data.value.encerradoEm" class="secundario" data-testid="mensagem-encerrada">
              {{
                t('trabalho.mensagens.encerradoAviso', {
                  em: dataHoraDe(leitura.data.value.encerradoEm),
                  motivo: leitura.data.value.motivoEncerramento ?? '—',
                })
              }}
            </p>
            <p class="texto" data-testid="mensagem-texto">{{ leitura.data.value.texto }}</p>
            <p v-if="leitura.data.value.contextoPaciente">
              <RouterLink
                :to="`/pep/paciente/${leitura.data.value.contextoPaciente}`"
                data-testid="msg-contexto"
                >{{ t('trabalho.mensagens.contexto') }}</RouterLink
              >
            </p>
            <div class="acoes">
              <SanteBotao
                v-if="
                  leitura.data.value.cienciaObrigatoria &&
                  !leitura.data.value.cienciaEm &&
                  !leitura.data.value.encerradoEm
                "
                :rotulo="t('trabalho.mensagens.darCiencia')"
                :desabilitado="ocupado"
                data-testid="dar-ciencia"
                @acionar="ciencia(leitura.data.value.id)"
              />
              <SanteBotao
                variante="secundario"
                :rotulo="t('trabalho.fechar')"
                data-testid="fechar-mensagem"
                @acionar="aberta = null"
              />
            </div>
          </template>
        </article>
      </template>
    </div>

    <!-- Enviadas -->
    <div
      v-if="aba === 'enviadas'"
      id="painel-enviadas"
      role="tabpanel"
      aria-labelledby="aba-enviadas"
      class="painel-aba"
    >
      <p v-if="!caixa.data.value" role="status">{{ t('trabalho.carregando') }}</p>
      <p v-else-if="caixa.data.value.enviadas.length === 0">{{ t('trabalho.mensagens.enviadasVazio') }}</p>
      <table v-else class="tabela" data-testid="tabela-enviadas">
        <caption class="sgh-visualmente-oculto">
          {{
            t('trabalho.mensagens.abas.enviadas')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('trabalho.mensagens.assunto') }}</th>
            <th scope="col">{{ t('trabalho.mensagens.em') }}</th>
            <th scope="col">{{ t('trabalho.mensagens.destinatarios') }}</th>
            <th scope="col">{{ t('trabalho.mensagens.lidas') }}</th>
            <th scope="col">{{ t('trabalho.mensagens.ciencias') }}</th>
            <th scope="col">{{ t('trabalho.mensagens.situacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in caixa.data.value.enviadas" :key="m.id" :data-testid="`enviada-${m.id}`">
            <td>
              <button
                v-if="m.tipo === 'comunicado' && podePublicar"
                type="button"
                class="link"
                :data-testid="`gerir-${m.id}`"
                @click="gerido = m.id"
              >
                <span class="chip">{{ t('trabalho.mensagens.comunicado') }}</span>
                {{ m.assunto }}
              </button>
              <template v-else>
                <span v-if="m.tipo === 'comunicado'" class="chip">{{
                  t('trabalho.mensagens.comunicado')
                }}</span>
                {{ m.assunto }}
              </template>
            </td>
            <td>{{ dataHoraDe(m.enviadaEm) }}</td>
            <td>{{ m.destinatarios }}</td>
            <td>{{ m.lidas }}</td>
            <td>{{ m.cienciaObrigatoria ? m.ciencias : '—' }}</td>
            <td>
              <span v-if="m.encerradoEm" class="chip">{{ t('trabalho.mensagens.encerrado') }}</span>
              <template v-else-if="m.vigenciaFim">{{
                t('trabalho.mensagens.ate', { ate: dataHoraDe(m.vigenciaFim) })
              }}</template>
              <template v-else>—</template>
            </td>
          </tr>
        </tbody>
      </table>
      <ComunicadoGestao v-if="gerido !== null" :id="gerido" @fechar="gerido = null" />
    </div>

    <!-- Nova mensagem / comunicado -->
    <form
      v-if="aba === 'nova' || aba === 'comunicado'"
      :id="`painel-${aba}`"
      role="tabpanel"
      :aria-labelledby="`aba-${aba}`"
      class="painel-aba formulario"
      novalidate
      data-testid="form-mensagem"
      @submit.prevent="enviar"
    >
      <p v-if="Object.keys(erros).length > 0" role="alert">
        <SanteAlerta variante="alerta" :texto="t('trabalho.mensagens.corrija')" />
      </p>
      <fieldset class="painel">
        <legend>{{ t('trabalho.mensagens.destinos') }}</legend>
        <div class="filtros">
          <SanteSelecao
            v-model="tipoDestino"
            :rotulo="t('trabalho.mensagens.tipoDestino')"
            :opcoes="tiposDestino"
            data-testid="msg-tipo-destino"
          />
          <SanteCampoTexto
            v-model="valorDestino"
            :rotulo="t('trabalho.mensagens.valorDestino')"
            :max-bytes="31"
            data-testid="msg-valor-destino"
            @keydown.enter.prevent="addDestino"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('trabalho.mensagens.adicionarDestino')"
            data-testid="msg-adicionar-destino"
            @acionar="addDestino"
          />
        </div>
        <ul v-if="destinos.length > 0" class="destinos" data-testid="msg-destinos">
          <li v-for="(d, i) in destinos" :key="`${d.tipo}-${d.valor}`">
            {{ t(`trabalho.mensagens.tiposDestino.${d.tipo}`) }}: <strong>{{ d.valor }}</strong>
            <SanteBotao
              variante="texto"
              :rotulo="t('trabalho.mensagens.removerDestino', { d: d.valor })"
              @acionar="tirar(i)"
            />
          </li>
        </ul>
        <p v-else class="secundario">{{ t('trabalho.mensagens.semDestino') }}</p>
        <p v-if="erros['destinos']" class="erro" data-testid="erro-destinos">{{ erros['destinos'] }}</p>
      </fieldset>
      <SanteCampoTexto
        v-model="assunto"
        :rotulo="t('trabalho.mensagens.assunto')"
        :max-bytes="120"
        obrigatorio
        data-testid="msg-assunto"
      />
      <p v-if="erros['assunto']" class="erro" data-testid="erro-assunto">{{ erros['assunto'] }}</p>
      <SanteCampoTexto
        v-model="texto"
        :rotulo="t('trabalho.mensagens.texto2')"
        :max-bytes="2000"
        multilinha
        obrigatorio
        data-testid="msg-texto"
      />
      <p v-if="erros['texto']" class="erro" data-testid="erro-texto">{{ erros['texto'] }}</p>
      <template v-if="aba === 'nova'">
        <SanteCampoTexto
          v-model="contexto"
          :rotulo="t('trabalho.mensagens.contextoAtendimento')"
          :max-bytes="10"
          data-testid="msg-contexto-atendimento"
        />
        <p class="secundario">{{ t('trabalho.mensagens.contextoDica') }}</p>
        <p v-if="erros['contextoAtendimento']" class="erro">{{ erros['contextoAtendimento'] }}</p>
      </template>
      <div v-else class="filtros">
        <div class="campo">
          <label for="msg-vig-ini">{{ t('trabalho.mensagens.vigenciaInicio') }}</label>
          <input
            id="msg-vig-ini"
            v-model="vigenciaInicio"
            type="datetime-local"
            data-testid="msg-vigencia-inicio"
          />
        </div>
        <div class="campo">
          <label for="msg-vig-fim">{{ t('trabalho.mensagens.vigenciaFim') }}</label>
          <input
            id="msg-vig-fim"
            v-model="vigenciaFim"
            type="datetime-local"
            data-testid="msg-vigencia-fim"
          />
        </div>
        <p v-if="erros['vigenciaInicio'] || erros['vigenciaFim']" class="erro">
          {{ erros['vigenciaFim'] ?? erros['vigenciaInicio'] }}
        </p>
      </div>
      <label class="marcar">
        <input v-model="cienciaObrigatoria" type="checkbox" data-testid="msg-ciencia" />
        {{ t('trabalho.mensagens.cienciaObrigatoria') }}
      </label>
      <div class="acoes">
        <SanteBotao
          tipo="submit"
          :rotulo="aba === 'comunicado' ? t('trabalho.mensagens.publicar') : t('trabalho.mensagens.enviar')"
          :desabilitado="ocupado"
          data-testid="msg-enviar"
        />
      </div>
    </form>

    <!-- Mensagens antigas -->
    <div
      v-if="aba === 'anteriores'"
      id="painel-anteriores"
      role="tabpanel"
      aria-labelledby="aba-anteriores"
      class="painel-aba"
    >
      <p class="secundario">{{ t('trabalho.mensagens.anterioresTexto') }}</p>
      <ErroTrabalho v-if="anteriores.isError.value" :erro="anteriores.error.value" />
      <p v-else-if="!anteriores.data.value" role="status">{{ t('trabalho.carregando') }}</p>
      <p v-else-if="anteriores.data.value.mensagens.length === 0">
        {{ t('trabalho.mensagens.anterioresVazio') }}
      </p>
      <table v-else class="tabela" data-testid="tabela-anteriores">
        <caption class="sgh-visualmente-oculto">
          {{
            t('trabalho.mensagens.abas.anteriores')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('trabalho.mensagens.em') }}</th>
            <th scope="col">{{ t('trabalho.mensagens.origem') }}</th>
            <th scope="col">{{ t('trabalho.mensagens.texto2') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in anteriores.data.value.mensagens" :key="m.sequencia">
            <td>{{ m.enviadaEm ? dataHoraDe(m.enviadaEm) : '—' }}</td>
            <td>{{ m.origem ?? '—' }}</td>
            <td class="texto">{{ m.texto }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.abas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda-forte);
}
.aba {
  min-height: var(--sgh-alvo-minimo);
  padding: 0 var(--sgh-espaco-3);
  background: none;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  color: var(--sgh-texto);
  font: inherit;
  cursor: pointer;
}
.aba[aria-selected='true'] {
  border-color: var(--sgh-borda-forte);
  font-weight: 700;
  background: var(--sgh-fundo-elevado);
}
.aba:focus-visible,
.link:focus-visible {
  outline: 2px solid var(--sgh-foco);
}
.painel-aba {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
}
.link {
  background: none;
  border: none;
  padding: 0;
  min-height: var(--sgh-alvo-minimo);
  color: var(--sgh-link, var(--sgh-primaria));
  text-decoration: underline;
  font: inherit;
  cursor: pointer;
  text-align: start;
}
.nova td {
  font-weight: 700;
}
.texto {
  white-space: pre-wrap;
}
.chip {
  display: inline-block;
  margin-right: var(--sgh-espaco-1);
  padding: 0 var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 4px;
  font-size: var(--sgh-fonte-pequena);
}
.destinos {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.erro {
  color: var(--sgh-alerta);
  font-weight: 600;
  margin: 0;
}
.marcar {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  min-height: var(--sgh-alvo-minimo);
}
.formulario fieldset {
  border: 1px solid var(--sgh-borda);
}
</style>
