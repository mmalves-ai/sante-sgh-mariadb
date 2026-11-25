<script setup lang="ts">
// 02-REC linha 33: montar a recepção pela tela. Cada recepção é um cartão com os seus guichês e os seus serviços de
// senha (os botões do balcão e do totem). Um só diálogo serve para incluir e alterar; o código, o prefixo, o número
// do guichê e a posição chegam sugeridos, e a regra do domínio confere na hora (o botão de gravar só abre com o
// formulário válido). Nada é apagado: desativar pede o motivo e o registro continua na lista, marcado.
import type { GuicheDaEstrutura, PontoDaEstrutura, ServicoDaEstrutura } from '@sgh/contratos';
import {
  codigoSugerido,
  prefixoSugerido,
  proximoGuiche,
  recusasDoGuiche,
  recusasDoPonto,
  recusasDoServico,
} from '@sgh/dominio-recepcao';
import { SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  alterarNaEstrutura,
  incluirNaEstrutura,
  type ItemEstrutura,
  lerEstrutura,
  situacaoNaEstrutura,
} from '../api-estrutura.js';

/** `tudo`: recepção, guichês e serviços; `servicos`: só os serviços de senha de cada recepção. */
const props = withDefaults(defineProps<{ foco?: 'tudo' | 'servicos' }>(), { foco: 'tudo' });

const { t } = useI18n();
const k = (c: string, p: Record<string, unknown> = {}) => t(`recepcao.estrutura.${c}`, p);
const cliente = useQueryClient();
const estrutura = useQuery({
  queryKey: ['recepcao', 'estrutura', props.foco],
  queryFn: () => lerEstrutura(props.foco === 'servicos'),
});
const pontos = computed(() => estrutura.data.value?.pontos ?? []);
const grupos = computed(() => estrutura.data.value?.gruposPrioridade ?? []);

const podePonto = computed(() => props.foco === 'tudo' && pode('recepcao.recepcao.editar'));
const podeCriarPonto = computed(() => props.foco === 'tudo' && pode('recepcao.recepcao.criar'));
const podeInativarPonto = computed(() => props.foco === 'tudo' && pode('recepcao.recepcao.inativar'));
const podeCriarServico = computed(() => pode('recepcao.gerador.criar'));
const podeServico = computed(() => pode('recepcao.gerador.editar'));
const podeInativarServico = computed(() => pode('recepcao.gerador.inativar'));

const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const gravando = ref(false);

// ── formulário único (incluir e alterar) ───────────────────────────────────────────────────────────────
interface Forma {
  readonly item: ItemEstrutura;
  readonly ponto: PontoDaEstrutura | null;
  readonly id: number | null;
  readonly versao: number | null;
  /** Tipo já cadastrado que a tela preserva (ligado a agenda, especialidade ou profissional). */
  readonly tipoPreservado: string | null;
}
const forma = ref<Forma | null>(null);
const codigo = ref('');
const nome = ref('');
const textoSenha = ref('');
const numero = ref('');
const prefixo = ref('');
const tipo = ref('geral');
const prioritaria = ref(false);
const grupo = ref('');
const limiteDia = ref('');
const ordemBotao = ref('');
/** O usuário já mexeu no campo sugerido (a sugestão para de acompanhar o nome). */
const tocouSugestao = ref(false);

const dialogo = computed({
  get: () => forma.value !== null,
  set: (v: boolean) => {
    if (!v) forma.value = null;
  },
});
const inteiroOuNulo = (v: string): number | null | undefined => {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isInteger(n) ? n : undefined;
};

function abrirPonto(p: PontoDaEstrutura | null): void {
  codigo.value = p?.codigo ?? '';
  nome.value = p?.descricao ?? '';
  textoSenha.value = p?.textoSenha ?? '';
  tocouSugestao.value = p !== null;
  forma.value = {
    item: 'ponto',
    ponto: p,
    id: p?.id ?? null,
    versao: p?.versao ?? null,
    tipoPreservado: null,
  };
}
function abrirGuiche(p: PontoDaEstrutura, g: GuicheDaEstrutura | null): void {
  numero.value = String(g?.numero ?? proximoGuiche(p.guiches.map((x) => x.numero)));
  nome.value = g?.descricao ?? '';
  forma.value = {
    item: 'guiche',
    ponto: p,
    id: g?.id ?? null,
    versao: g?.versao ?? null,
    tipoPreservado: null,
  };
}
function abrirServico(p: PontoDaEstrutura, s: ServicoDaEstrutura | null): void {
  const preservado = s && s.tipo !== 'geral' && s.tipo !== 'diverso' ? s.tipo : null;
  prefixo.value = s?.prefixo ?? '';
  nome.value = s?.descricao ?? '';
  tipo.value = preservado ? 'geral' : (s?.tipo ?? 'geral');
  prioritaria.value = s?.prioritaria ?? false;
  grupo.value = s?.grupoPrioridade ?? '';
  limiteDia.value = s?.limiteDia === null || s === null ? '' : String(s.limiteDia);
  const maior = Math.max(0, ...p.servicos.map((x) => x.ordemBotao ?? 0));
  ordemBotao.value = s ? (s.ordemBotao === null ? '' : String(s.ordemBotao)) : String(maior + 1);
  tocouSugestao.value = s !== null;
  forma.value = {
    item: 'servico',
    ponto: p,
    id: s?.id ?? null,
    versao: s?.versao ?? null,
    tipoPreservado: preservado,
  };
}

// As sugestões acompanham o nome enquanto o usuário não mexe no campo sugerido.
watch(nome, (n) => {
  const f = forma.value;
  if (!f || f.id !== null || tocouSugestao.value) return;
  if (f.item === 'ponto')
    codigo.value = n.trim()
      ? codigoSugerido(
          n,
          pontos.value.map((p) => p.codigo),
        )
      : '';
  if (f.item === 'servico' && f.ponto)
    prefixo.value = n.trim()
      ? prefixoSugerido(
          n,
          f.ponto.servicos.map((s) => s.prefixo),
        )
      : '';
});
// O grupo de prioridade legal marca o botão como prioritário (uma escolha a menos).
watch(grupo, (g) => {
  if (g) prioritaria.value = true;
});

const corpo = computed<Record<string, unknown> | null>(() => {
  const f = forma.value;
  if (!f) return null;
  if (f.item === 'ponto')
    return {
      codigo: codigo.value.trim(),
      descricao: nome.value.trim(),
      textoSenha: textoSenha.value.trim() || null,
    };
  if (f.item === 'guiche') {
    const n = inteiroOuNulo(numero.value);
    return typeof n === 'number' ? { numero: n, descricao: nome.value.trim() || null } : null;
  }
  const limite = inteiroOuNulo(limiteDia.value);
  const ordem = inteiroOuNulo(ordemBotao.value);
  if (limite === undefined || ordem === undefined) return null;
  return {
    prefixo: prefixo.value.trim().toUpperCase(),
    descricao: nome.value.trim(),
    tipo: f.tipoPreservado ?? tipo.value,
    prioritaria: prioritaria.value,
    grupoPrioridade: grupo.value || null,
    limiteDia: limite,
    ordemBotao: ordem,
  };
});

/** A primeira recusa da regra do domínio para o que está digitado (null: pode gravar). */
const recusa = computed<string | null>(() => {
  const f = forma.value;
  const c = corpo.value;
  if (!f) return null;
  if (!c) return k('numeroInvalido');
  if (f.item === 'ponto') return recusasDoPonto(c as never, pontos.value, f.id)[0]?.mensagem ?? null;
  if (!f.ponto) return null;
  if (f.item === 'guiche') return recusasDoGuiche(c as never, f.ponto.guiches, f.id)[0]?.mensagem ?? null;
  const aceitos = grupos.value.map((g) => g.codigo);
  if (grupo.value && !aceitos.includes(grupo.value)) aceitos.push(grupo.value);
  return (
    recusasDoServico(
      {
        ...(c as never as Parameters<typeof recusasDoServico>[0]),
        tipo: f.tipoPreservado ? 'geral' : tipo.value,
      },
      f.ponto.servicos,
      aceitos,
      f.id,
    )[0]?.mensagem ?? null
  );
});
/** Só mostra a recusa depois de haver algo digitado no nome (formulário novo não nasce com erro). */
const recusaVisivel = computed(() =>
  forma.value?.item === 'guiche' || nome.value.trim() !== '' ? recusa.value : null,
);

const tituloDialogo = computed(() => {
  const f = forma.value;
  if (!f) return '';
  if (f.item === 'ponto')
    return f.id === null ? k('novaRecepcao') : k('editarRecepcao', { nome: f.ponto?.descricao });
  if (f.item === 'guiche')
    return f.id === null
      ? k('novoGuicheEm', { nome: f.ponto?.descricao })
      : k('editarGuiche', { numero: numero.value });
  return f.id === null
    ? k('novoServicoEm', { nome: f.ponto?.descricao })
    : k('editarServico', { nome: nome.value });
});
const opcoesTipo = computed(() => [
  { valor: 'geral', rotulo: k('tipos.geral') },
  { valor: 'diverso', rotulo: k('tipos.diverso') },
]);
const opcoesGrupo = computed(() => [
  { valor: '', rotulo: k('semGrupo') },
  ...grupos.value.map((g) => ({ valor: g.codigo, rotulo: g.descricao })),
]);
const nomeDoGrupo = (c: string | null) => grupos.value.find((g) => g.codigo === c)?.descricao ?? c ?? '';

async function executar(fn: () => Promise<{ mensagem: string }>): Promise<void> {
  gravando.value = true;
  mensagem.value = null;
  erro.value = null;
  try {
    mensagem.value = (await fn()).mensagem;
    forma.value = null;
    desativando.value = null;
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
    await cliente.invalidateQueries({ queryKey: ['recepcao'] });
  }
}
function gravar(): Promise<void> {
  const f = forma.value;
  const c = corpo.value;
  if (!f || !c || recusa.value !== null) return Promise.resolve();
  return executar(() =>
    f.id === null
      ? incluirNaEstrutura(f.item, f.ponto?.id ?? null, c)
      : alterarNaEstrutura(f.item, f.id, { ...c, versao: f.versao }),
  );
}

// ── desativar (com motivo) e reativar ──────────────────────────────────────────────────────────────────
interface Alvo {
  readonly item: ItemEstrutura;
  readonly id: number;
  readonly versao: number;
  readonly nome: string;
}
const desativando = ref<Alvo | null>(null);
const motivo = ref('');
const dialogoDesativar = computed({
  get: () => desativando.value !== null,
  set: (v: boolean) => {
    if (!v) desativando.value = null;
  },
});
function pedirDesativar(a: Alvo): void {
  motivo.value = '';
  desativando.value = a;
}
const motivoValido = computed(() => motivo.value.trim().length >= 5);
function desativar(): Promise<void> {
  const a = desativando.value;
  if (!a || !motivoValido.value) return Promise.resolve();
  return executar(() =>
    situacaoNaEstrutura(a.item, a.id, { ativo: false, motivo: motivo.value.trim(), versao: a.versao }),
  );
}
const reativar = (a: Alvo) =>
  executar(() => situacaoNaEstrutura(a.item, a.id, { ativo: true, motivo: null, versao: a.versao }));
</script>

<template>
  <section class="painel" aria-labelledby="estrutura-cadastro-titulo" data-testid="estrutura-recepcao">
    <h2 id="estrutura-cadastro-titulo">{{ k('titulo') }}</h2>
    <p class="secundario">{{ k('texto') }}</p>
    <div v-if="podeCriarPonto" class="acoes-linha">
      <SanteBotao :rotulo="k('novaRecepcao')" data-testid="nova-recepcao" @acionar="abrirPonto(null)" />
    </div>
    <p v-if="mensagem" role="status" data-testid="mensagem-estrutura">{{ mensagem }}</p>
    <MensagemErro v-if="erro && !forma && !desativando" :erro="erro" />
    <MensagemErro v-if="estrutura.isError.value" :erro="estrutura.error.value" />
    <p v-else-if="!estrutura.data.value" role="status">{{ t('recepcao.carregando') }}</p>
    <p v-else-if="pontos.length === 0" data-testid="estrutura-vazia">{{ k('vazio') }}</p>

    <article v-for="p in pontos" :key="p.id" class="painel" :data-testid="`ponto-${p.codigo}`">
      <h3>
        {{ p.descricao }} <span class="secundario">· {{ p.codigo }}</span>
        <template v-if="!p.ativo"> · {{ k('inativo') }}</template>
      </h3>
      <div v-if="foco === 'tudo'" class="acoes-linha">
        <SanteBotao
          v-if="podePonto"
          variante="texto"
          :rotulo="k('alterar')"
          :aria-label="k('editarRecepcao', { nome: p.descricao })"
          :data-testid="`alterar-ponto-${p.codigo}`"
          @acionar="abrirPonto(p)"
        />
        <SanteBotao
          v-if="podeInativarPonto && p.ativo"
          variante="texto"
          :rotulo="k('desativar')"
          :aria-label="k('desativarTitulo', { nome: p.descricao })"
          :data-testid="`desativar-ponto-${p.codigo}`"
          @acionar="pedirDesativar({ item: 'ponto', id: p.id, versao: p.versao, nome: p.descricao })"
        />
        <SanteBotao
          v-if="podeInativarPonto && !p.ativo"
          variante="texto"
          :rotulo="k('reativar')"
          :data-testid="`reativar-ponto-${p.codigo}`"
          @acionar="reativar({ item: 'ponto', id: p.id, versao: p.versao, nome: p.descricao })"
        />
      </div>

      <template v-if="foco === 'tudo'">
        <h4>{{ k('guiches') }}</h4>
        <p v-if="p.guiches.length === 0" class="secundario">{{ k('semGuiche') }}</p>
        <ul v-else class="senhas-no-guiche" :data-testid="`guiches-${p.codigo}`">
          <li v-for="g in p.guiches" :key="g.id" :data-testid="`guiche-${p.codigo}-${g.numero}`">
            <strong>{{ k('guiche', { numero: g.numero }) }}</strong>
            <template v-if="g.descricao"> · {{ g.descricao }}</template>
            <template v-if="g.aberto"> · {{ k('aberto') }}</template>
            <template v-if="!g.ativo"> · {{ k('inativo') }}</template>
            <template v-if="podePonto">
              <SanteBotao
                variante="texto"
                :rotulo="k('alterar')"
                :aria-label="k('editarGuiche', { numero: g.numero })"
                @acionar="abrirGuiche(p, g)"
              />
              <SanteBotao
                v-if="g.ativo"
                variante="texto"
                :rotulo="k('desativar')"
                :aria-label="k('desativarTitulo', { nome: k('guiche', { numero: g.numero }) })"
                :data-testid="`desativar-guiche-${p.codigo}-${g.numero}`"
                @acionar="
                  pedirDesativar({
                    item: 'guiche',
                    id: g.id,
                    versao: g.versao,
                    nome: k('guiche', { numero: g.numero }),
                  })
                "
              />
              <SanteBotao
                v-else
                variante="texto"
                :rotulo="k('reativar')"
                :aria-label="`${k('reativar')}: ${k('guiche', { numero: g.numero })}`"
                @acionar="reativar({ item: 'guiche', id: g.id, versao: g.versao, nome: '' })"
              />
            </template>
          </li>
        </ul>
        <SanteBotao
          v-if="podePonto && p.ativo"
          variante="secundario"
          :rotulo="k('novoGuiche')"
          :aria-label="k('novoGuicheEm', { nome: p.descricao })"
          :data-testid="`novo-guiche-${p.codigo}`"
          @acionar="abrirGuiche(p, null)"
        />
      </template>

      <h4>{{ k('servicos') }}</h4>
      <p v-if="p.servicos.length === 0" class="secundario">{{ k('semServico') }}</p>
      <table v-else class="tabela" :data-testid="`servicos-${p.codigo}`">
        <caption class="visualmente-oculto">
          {{
            k('servicos')
          }}:
          {{
            p.descricao
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ k('colPosicao') }}</th>
            <th scope="col">{{ t('recepcao.servico') }}</th>
            <th scope="col">{{ k('colPrioridade') }}</th>
            <th scope="col">{{ k('colLimite') }}</th>
            <th scope="col">{{ k('colSituacao') }}</th>
            <th scope="col">{{ k('acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in p.servicos" :key="s.id" :data-testid="`servico-${p.codigo}-${s.prefixo}`">
            <td>{{ s.ordemBotao ?? '—' }}</td>
            <td>
              <strong>{{ s.prefixo }}</strong> · {{ s.descricao }}
              <span class="secundario">
                ·
                {{ s.tipo === 'geral' || s.tipo === 'diverso' ? k(`tipos.${s.tipo}`) : k('tipos.outro') }}
              </span>
            </td>
            <td>
              {{
                s.prioritaria
                  ? nomeDoGrupo(s.grupoPrioridade) || t('recepcao.geradores.prioritaria')
                  : k('normal')
              }}
            </td>
            <td>{{ s.limiteDia ?? '—' }}</td>
            <td>{{ s.ativo ? k('ativo') : k('inativo') }}</td>
            <td>
              <SanteBotao
                v-if="podeServico"
                variante="texto"
                :rotulo="k('alterar')"
                :aria-label="k('editarServico', { nome: s.descricao })"
                :data-testid="`alterar-servico-${p.codigo}-${s.prefixo}`"
                @acionar="abrirServico(p, s)"
              />
              <SanteBotao
                v-if="podeInativarServico && s.ativo"
                variante="texto"
                :rotulo="k('desativar')"
                :aria-label="k('desativarTitulo', { nome: s.descricao })"
                :data-testid="`desativar-servico-${p.codigo}-${s.prefixo}`"
                @acionar="pedirDesativar({ item: 'servico', id: s.id, versao: s.versao, nome: s.descricao })"
              />
              <SanteBotao
                v-if="podeInativarServico && !s.ativo"
                variante="texto"
                :rotulo="k('reativar')"
                :aria-label="`${k('reativar')}: ${s.descricao}`"
                :data-testid="`reativar-servico-${p.codigo}-${s.prefixo}`"
                @acionar="reativar({ item: 'servico', id: s.id, versao: s.versao, nome: s.descricao })"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        v-if="podeCriarServico && p.ativo"
        variante="secundario"
        :rotulo="k('novoServico')"
        :aria-label="k('novoServicoEm', { nome: p.descricao })"
        :data-testid="`novo-servico-${p.codigo}`"
        @acionar="abrirServico(p, null)"
      />
    </article>

    <SanteDialogo v-model:visivel="dialogo" :titulo="tituloDialogo">
      <div v-if="forma" class="formulario" data-testid="formulario-estrutura">
        <template v-if="forma.item === 'ponto'">
          <SanteCampoTexto v-model="nome" :rotulo="k('nome')" :max-bytes="150" obrigatorio />
          <SanteCampoTexto
            v-model="codigo"
            :rotulo="k('codigo')"
            :max-bytes="30"
            obrigatorio
            @update:model-value="tocouSugestao = true"
          />
          <SanteCampoTexto v-model="textoSenha" :rotulo="k('textoSenha')" :max-bytes="500" multilinha />
        </template>
        <template v-else-if="forma.item === 'guiche'">
          <div class="campo">
            <label for="estrutura-numero">{{ k('numero') }}</label>
            <input id="estrutura-numero" v-model="numero" type="number" min="1" max="999" />
          </div>
          <SanteCampoTexto v-model="nome" :rotulo="k('descricaoGuiche')" :max-bytes="150" />
        </template>
        <template v-else>
          <SanteCampoTexto v-model="nome" :rotulo="k('nomeServico')" :max-bytes="150" obrigatorio />
          <SanteCampoTexto
            v-model="prefixo"
            :rotulo="k('prefixo')"
            :max-bytes="3"
            obrigatorio
            @update:model-value="tocouSugestao = true"
          />
          <SanteSelecao
            v-if="!forma.tipoPreservado"
            v-model="tipo"
            :rotulo="k('tipo')"
            :opcoes="opcoesTipo"
            data-testid="estrutura-tipo"
          />
          <p v-else class="secundario">{{ k('tipo') }}: {{ k('tipos.outro') }}</p>
          <SanteSelecao
            v-model="grupo"
            :rotulo="k('grupo')"
            :opcoes="opcoesGrupo"
            data-testid="estrutura-grupo"
          />
          <label
            ><input v-model="prioritaria" type="checkbox" :disabled="grupo !== ''" />
            {{ k('prioritaria') }}</label
          >
          <div class="campo">
            <label for="estrutura-limite">{{ k('limiteDia') }}</label>
            <input id="estrutura-limite" v-model="limiteDia" type="number" min="1" max="9999" />
          </div>
          <div class="campo">
            <label for="estrutura-ordem">{{ k('ordemBotao') }}</label>
            <input id="estrutura-ordem" v-model="ordemBotao" type="number" min="1" max="999" />
          </div>
        </template>
        <p v-if="recusaVisivel" role="alert" data-testid="recusa-estrutura">{{ recusaVisivel }}</p>
        <MensagemErro v-if="erro" :erro="erro" />
      </div>
      <template #rodape>
        <SanteBotao variante="secundario" :rotulo="t('recepcao.cancelar')" @acionar="forma = null" />
        <SanteBotao
          :rotulo="t('recepcao.gravar')"
          :desabilitado="gravando || recusa !== null"
          data-testid="gravar-estrutura"
          @acionar="gravar"
        />
      </template>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoDesativar"
      :titulo="k('desativarTitulo', { nome: desativando?.nome ?? '' })"
    >
      <div class="formulario">
        <p>{{ k('desativarTexto') }}</p>
        <SanteCampoTexto v-model="motivo" :rotulo="k('motivo')" :max-bytes="200" obrigatorio />
        <p v-if="motivo !== '' && !motivoValido" role="alert">{{ k('motivoCurto') }}</p>
        <MensagemErro v-if="erro" :erro="erro" />
      </div>
      <template #rodape>
        <SanteBotao variante="secundario" :rotulo="t('recepcao.cancelar')" @acionar="desativando = null" />
        <SanteBotao
          :rotulo="k('desativar')"
          :desabilitado="gravando || !motivoValido"
          data-testid="confirmar-desativar"
          @acionar="desativar"
        />
      </template>
    </SanteDialogo>
  </section>
</template>
